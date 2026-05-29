/**
 * 🛡️ AEGIS. AI Agent for GuardAgent
 *
 * Replaces the old regex-based chat with Claude tool_use.
 * Aegis calls functions directly (no HTTP self-call, no regex parsing).
 *
 * Architecture:
 *   User message → Aegis → Claude tool_use → tool handler → result → Claude → response
 *   Claude can chain multiple tools in one conversation turn (multi-step reasoning).
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { explorerTxUrl } from './arckit';
import { evaluateAction } from './guardian';
import { logAudit } from './audit';
import { getEarnInfo, getEarnPosition, earnDeposit, earnWithdraw } from './arcEarn';
import { getGatewayBalance, gatewayDeposit, gatewaySpend } from './arcGateway';
import { getAegisStatus, searchAegisServices, aegisPay } from './aegisWallet';
import { getBridgeQuote, executeBridge, getBridgeProgress, getSupportedChainDetails } from './arcBridge';
import {
  createJob as createOnchainJob,
  setJobBudget,
  approveUsdcForJobs,
  fundJob,
  submitDeliverable,
  completeJob,
  getOnChainJob,
  bytes32FromText,
} from './arcJobs';
import { GuardianAction } from '@guardagent/guardian';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AegisContext {
  userId: string;
  walletAddress: string;
  agentAddress: string;
  network: 'arc-mainnet' | 'arc-testnet';
  maxTxSizeUsd: number;
  dailyLimitUsd: number;
  slippage: number;
  autoMode: boolean;
}

export interface ToolTrace {
  name: string;
  input?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  cost?: string;
}

interface AegisResponse {
  text: string;
  actions?: string[];            // for frontend UI (confirm_swap, token_select, etc.)
  ruleCreated?: boolean;
  settingsUpdated?: boolean;
  swapCompleted?: boolean;
  toolsUsed?: ToolTrace[];       // shown as "Aegis used X" indicator
}

// ─── Claude Client ───────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// ─── Tool Definitions ────────────────────────────────────────────────────────
// These are sent to Claude so it knows what functions it can call.

const AEGIS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_wallet_balances',
    description: 'Get all token balances in the user\'s agent wallet. Returns ETH + all ERC-20 tokens with USD values. Always call this before discussing balances or preparing swaps.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'find_token',
    description: 'Search for a token by symbol or contract address on Arc. Returns token info: price, holders, liquidity, market cap, verification status. Use this when user mentions an unknown token or pastes a contract address.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Token symbol (e.g. "BRETT") or contract address (0x...)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_swap_quote',
    description: 'Get a price quote for swapping tokens. Returns estimated output, rate, price impact, fees. Does NOT execute the swap, just shows the quote. Always call this before proposing a swap to the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: { type: 'string', description: 'Source token symbol (e.g. "ETH")' },
        to_token: { type: 'string', description: 'Destination token symbol (e.g. "USDC")' },
        amount: { type: 'number', description: 'Amount of source token to swap' },
      },
      required: ['from_token', 'to_token', 'amount'],
    },
  },
  {
    name: 'execute_swap',
    description: 'Execute a token swap on Arc. This is a REAL transaction that moves funds. Only call this after user has explicitly confirmed they want to swap. Returns transaction hash and amounts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: { type: 'string', description: 'Source token symbol' },
        to_token: { type: 'string', description: 'Destination token symbol' },
        amount: { type: 'number', description: 'Amount of source token to swap' },
      },
      required: ['from_token', 'to_token', 'amount'],
    },
  },
  {
    name: 'create_price_rule',
    description: 'Create a price alert rule. When the token price crosses the threshold, the user gets notified. Example: alert when ETH goes below $3000.',
    input_schema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Token symbol (e.g. "ETH")' },
        condition: { type: 'string', enum: ['ABOVE', 'BELOW'], description: 'Alert when price goes ABOVE or BELOW threshold' },
        threshold: { type: 'number', description: 'Price threshold in USD' },
        name: { type: 'string', description: 'Short descriptive name for the rule' },
      },
      required: ['token', 'condition', 'threshold'],
    },
  },
  {
    name: 'update_settings',
    description: 'Update agent wallet settings: max swap size, daily limit, or auto-mode. Warn user before enabling auto-mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_tx_size_usd: { type: 'number', description: 'Maximum single swap size in USD' },
        daily_limit_usd: { type: 'number', description: 'Daily total swap limit in USD' },
        auto_mode: { type: 'boolean', description: 'Enable/disable auto-execution of protective swaps' },
      },
      required: [],
    },
  },
  {
    name: 'get_yield_rates',
    description: 'Get current DeFi yield/APY rates on Arc. Returns live yield rates for Arc assets like USYC.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'show_amount_options',
    description: 'Show percentage buttons (10%, 25%, 50%, 100%) so the user can pick how much to swap. Call this when user wants to swap but did not specify an amount. You must know both from_token and to_token before calling this.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: { type: 'string', description: 'Source token symbol (e.g. "ETH")' },
        to_token: { type: 'string', description: 'Destination token symbol (e.g. "USDC")' },
        balance: { type: 'number', description: 'User balance of the source token' },
      },
      required: ['from_token', 'to_token', 'balance'],
    },
  },
  {
    name: 'check_token_safety',
    description: 'Check if a token is safe to trade. Returns reputation data: past swap success/failure rate, scam flags, suggested slippage. Call this before executing swaps to unknown tokens.',
    input_schema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Token symbol or contract address' },
      },
      required: ['token'],
    },
  },
  {
    name: 'create_limit_order',
    description: 'Create a limit order, automatically swap tokens when price reaches a target. Example: "sell 0.5 ETH when ETH hits $4000" or "buy ETH with 500 USDC when ETH drops to $2500".',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: { type: 'string', description: 'Token to sell/swap from (e.g. "ETH")' },
        to_token: { type: 'string', description: 'Token to buy/swap to (e.g. "USDC")' },
        amount: { type: 'string', description: 'Amount of from_token to swap (e.g. "0.5")' },
        trigger_price: { type: 'number', description: 'USD price of the watched token that triggers the swap' },
        direction: { type: 'string', enum: ['ABOVE', 'BELOW'], description: 'Trigger when price goes ABOVE or BELOW trigger_price' },
        slippage: { type: 'number', description: 'Slippage tolerance percent (optional, default 0.5)' },
        expires_hours: { type: 'number', description: 'Hours until order expires (optional, e.g. 24 for 1 day)' },
      },
      required: ['from_token', 'to_token', 'amount', 'trigger_price', 'direction'],
    },
  },
  {
    name: 'list_limit_orders',
    description: 'List all limit orders for the user. Shows active, filled, cancelled, and expired orders.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_limit_order',
    description: 'Cancel an active limit order by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string', description: 'The ID of the limit order to cancel' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'create_dca_order',
    description: 'Create a DCA (Dollar-Cost Averaging) order, automatically buy tokens at regular intervals. Example: "buy $50 of ETH every day" or "buy 10 USDC of BTC every week".',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_token: { type: 'string', description: 'Token to spend (e.g. "USDC")' },
        to_token: { type: 'string', description: 'Token to buy (e.g. "ETH")' },
        amount_per_cycle: { type: 'string', description: 'Amount of from_token to spend each cycle (e.g. "50")' },
        frequency: { type: 'string', enum: ['HOURLY', 'DAILY', 'WEEKLY'], description: 'How often to execute the DCA' },
        max_runs: { type: 'number', description: 'Maximum number of cycles to run (optional, omit for unlimited)' },
      },
      required: ['from_token', 'to_token', 'amount_per_cycle', 'frequency'],
    },
  },
  {
    name: 'list_dca_orders',
    description: 'List all DCA orders for the user. Shows active, paused, completed, and failed orders.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'manage_dca_order',
    description: 'Pause, resume, or cancel a DCA order by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string', description: 'The ID of the DCA order' },
        action: { type: 'string', enum: ['pause', 'resume', 'cancel'], description: 'Action to perform' },
      },
      required: ['order_id', 'action'],
    },
  },
  {
    name: 'update_guardrails',
    description: 'Update spending guardrails: slippage tolerance, token allowlist (only allowed tokens can be traded), or token blocklist (these tokens are always blocked). Use this when user wants to restrict or allow specific tokens.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slippage_percent: { type: 'number', description: 'New slippage tolerance percent (e.g. 0.5 for 0.5%)' },
        add_to_allowlist: { type: 'array', items: { type: 'string' }, description: 'Token symbols to add to allowlist' },
        remove_from_allowlist: { type: 'array', items: { type: 'string' }, description: 'Token symbols to remove from allowlist' },
        clear_allowlist: { type: 'boolean', description: 'Set to true to clear the entire allowlist (allow all tokens)' },
        add_to_blocklist: { type: 'array', items: { type: 'string' }, description: 'Token symbols to block' },
        remove_from_blocklist: { type: 'array', items: { type: 'string' }, description: 'Token symbols to remove from blocklist' },
      },
      required: [],
    },
  },
  {
    name: 'earn_info',
    description: 'Get the Circle Earn vault on Arc (name, protocol, APY, status) and the user\'s current deposited position. Use before discussing yield or earning.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'earn_deposit',
    description: 'Deposit idle USDC from the agent wallet into the Circle Earn vault on Arc to earn yield. Subject to Guardian policy.',
    input_schema: {
      type: 'object' as const,
      properties: { amount: { type: 'string', description: 'Amount of USDC to deposit, e.g. "5"' } },
      required: ['amount'],
    },
  },
  {
    name: 'earn_withdraw',
    description: 'Withdraw USDC from the Circle Earn vault back to the agent wallet. Subject to Guardian policy.',
    input_schema: {
      type: 'object' as const,
      properties: { amount: { type: 'string', description: 'Amount of USDC to withdraw, e.g. "5"' } },
      required: ['amount'],
    },
  },
  {
    name: 'gateway_balance',
    description: 'Get the unified cross-chain USDC balance held in Circle Gateway across all chains.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'gateway_deposit',
    description: 'Deposit USDC from the Arc agent wallet into Circle Gateway (unified balance). Subject to Guardian policy.',
    input_schema: {
      type: 'object' as const,
      properties: { amount: { type: 'string', description: 'Amount of USDC to deposit' } },
      required: ['amount'],
    },
  },
  {
    name: 'gateway_spend',
    description: 'Spend USDC from the Gateway unified balance, minting it instantly on another chain to a recipient. Subject to Guardian policy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to_chain: { type: 'string', description: 'Destination chain, e.g. "base-sepolia", "ethereum-sepolia"' },
        amount: { type: 'string', description: 'Amount of USDC to spend' },
        recipient: { type: 'string', description: 'Recipient 0x address on the destination chain' },
      },
      required: ['to_chain', 'amount', 'recipient'],
    },
  },
  {
    name: 'aegis_search_marketplace',
    description: 'Search the Circle Agent Marketplace for paid x402 services (live data feeds, oracles, web search, prediction-market odds, etc.) that Aegis can pay for in USDC from its own non-custodial wallet. Use this BEFORE saying "I cannot do that" or "I do not have live data", many capabilities you think you lack are one search away. Examples: keyword="crypto price", "polymarket", "weather", "twitter", "prediction markets". Returns up to 10 services with name, URL, price per call, supported chains.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: 'Search term, e.g. "crypto price", "polymarket odds", "weather"' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'send_usdc',
    description: 'Send USDC or EURC to an EVM address. Goes through Guardian policy: auto-executes if within limits, sends Telegram approval request if above threshold, blocks if over per-tx cap or denied. ALWAYS confirm the destination address and amount with the user before calling this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Token to send: USDC or EURC' },
        amount: { type: 'number', description: 'Amount to send (e.g. 10 for 10 USDC)' },
        to_address: { type: 'string', description: 'Destination EVM address (0x followed by 40 hex characters)' },
      },
      required: ['token', 'amount', 'to_address'],
    },
  },
  {
    name: 'list_bridge_chains',
    description: 'List supported destination chains for CCTP bridging out of Arc Testnet (e.g. ethereum-sepolia, base-sepolia). Returns chain id, name, and whether the Forwarding Service auto-mints on destination. Always call this before get_bridge_quote so the user picks a real chain.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_bridge_quote',
    description: 'Estimate USDC bridge from Arc Testnet to a destination chain via CCTP. Returns gas fees, protocol fees, and whether the destination supports the Forwarding Service (so recipient does not need destination gas). Does NOT execute. Always call this before execute_bridge so the user sees the cost.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to_chain: { type: 'string', description: 'Destination chain id from list_bridge_chains (e.g. "ethereum-sepolia", "base-sepolia")' },
        amount: { type: 'string', description: 'USDC amount as a decimal string, e.g. "10" or "10.5"' },
        transfer_speed: { type: 'string', enum: ['FAST', 'SLOW'], description: 'FAST = CCTP v2 fast finality (default); SLOW = lower fee' },
      },
      required: ['to_chain', 'amount'],
    },
  },
  {
    name: 'execute_bridge',
    description: 'Bridge USDC from the user agent wallet on Arc Testnet to the same EVM address on a destination chain via CCTP. Goes through Guardian policy: auto-executes if within limits, sends Telegram approval if above threshold. ALWAYS confirm to_chain and amount with the user, and ALWAYS call get_bridge_quote first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to_chain: { type: 'string', description: 'Destination chain id (e.g. "ethereum-sepolia")' },
        amount: { type: 'string', description: 'USDC amount as a decimal string' },
        destination_address: { type: 'string', description: 'Optional 0x recipient on destination chain. Defaults to the same agent wallet address.' },
        transfer_speed: { type: 'string', enum: ['FAST', 'SLOW'], description: 'FAST (default) or SLOW' },
      },
      required: ['to_chain', 'amount'],
    },
  },
  {
    name: 'get_bridge_progress',
    description: 'Get the progress events for an in-flight bridge transaction by id (from execute_bridge). Use this when the user asks about a bridge they just submitted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        bridge_id: { type: 'string', description: 'Bridge transaction id returned by execute_bridge' },
      },
      required: ['bridge_id'],
    },
  },
  {
    name: 'create_autonomous_bridge_rule',
    description: 'Create a rule that AUTONOMOUSLY bridges USDC to another chain when the user agent wallet USDC balance reaches a threshold. Worker runs this rule every minute; on trigger, Guardian policy is re-checked and if it ALLOWs, the bridge executes without further user interaction. Use this when the user says things like "when I have more than 100 USDC, bridge 50 to base", "auto-bridge to base", "rebalance to base when over X".',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short human label for the rule, e.g. "Excess USDC to Base"' },
        balance_threshold_usdc: { type: 'number', description: 'Trigger when agent USDC balance is at least this many USDC' },
        bridge_to_chain: { type: 'string', description: 'Destination chain id (e.g. "base-sepolia", "ethereum-sepolia")' },
        bridge_amount_usdc: { type: 'string', description: 'How much USDC to bridge per trigger (decimal string, e.g. "5")' },
        bridge_dest_address: { type: 'string', description: 'Optional 0x recipient on destination chain. Defaults to user agent wallet address.' },
        cooldown_minutes: { type: 'number', description: 'Minimum minutes between consecutive triggers (default 60, min 30)' },
      },
      required: ['name', 'balance_threshold_usdc', 'bridge_to_chain', 'bridge_amount_usdc'],
    },
  },
  {
    name: 'list_my_jobs',
    description: 'List ERC-8183 jobs where the user is client, provider, or evaluator. Returns recent jobs with status (DRAFT/OPEN/FUNDED/SUBMITTED/COMPLETED), roles, budget, and txHashes. Use to find a job_id before taking an action.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_job',
    description: 'Create an ERC-8183 job on Arc and publish it on-chain. User becomes the client. Provider and evaluator are addresses you specify. Description is what the provider must deliver. After this, the provider calls set_job_budget, then client calls fund_job. ALWAYS confirm provider/evaluator addresses and description with the user first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider_address: { type: 'string', description: 'Full 0x address (42 chars) of the provider, OR the literal string "self" to use the user\'s own agent wallet (see USER AGENT WALLET ADDRESS in system prompt). Never abbreviate or fabricate an address, if the user says "my address" / "use me", pass "self".' },
        evaluator_address: { type: 'string', description: 'Full 0x address of the evaluator, OR "self" to use the user\'s own agent wallet. Often = client for solo demos.' },
        description: { type: 'string', description: 'What the provider should deliver, 1-500 characters' },
        expires_in_hours: { type: 'number', description: 'Job expiry in hours from now (default 24)' },
      },
      required: ['provider_address', 'evaluator_address', 'description'],
    },
  },
  {
    name: 'set_job_budget',
    description: 'Provider sets the USDC budget on an OPEN job. Only callable by the named provider. Use list_my_jobs to find the local job id first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_db_id: { type: 'string', description: 'Local job id (from list_my_jobs.id)' },
        amount_usdc: { type: 'number', description: 'Budget in USDC (e.g. 5 = 5 USDC)' },
      },
      required: ['job_db_id', 'amount_usdc'],
    },
  },
  {
    name: 'fund_job',
    description: 'Client funds the escrow on an OPEN job that has a budget. Sends approve + fund txs (USDC moves from client wallet to escrow). Goes through Guardian policy (auto-execute if within limit, Telegram approval if over threshold). Only callable by the named client.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_db_id: { type: 'string', description: 'Local job id' },
      },
      required: ['job_db_id'],
    },
  },
  {
    name: 'submit_job_deliverable',
    description: 'Provider submits a deliverable hash on a FUNDED job. The text you pass is keccak256-hashed on-chain so providing a description is fine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_db_id: { type: 'string', description: 'Local job id' },
        deliverable_text: { type: 'string', description: 'Plain text describing the deliverable; we hash it' },
      },
      required: ['job_db_id', 'deliverable_text'],
    },
  },
  {
    name: 'complete_job',
    description: 'Evaluator completes a SUBMITTED job, which releases the escrowed USDC to the provider. Reason text is hashed on-chain. Only callable by the named evaluator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_db_id: { type: 'string', description: 'Local job id' },
        reason_text: { type: 'string', description: 'Plain text reason (e.g. "approved", "quality good"); we hash it' },
      },
      required: ['job_db_id', 'reason_text'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Get the current state of a job, both DB record and live on-chain status if published. Use to check progress or see what role can act next.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_db_id: { type: 'string', description: 'Local job id' },
      },
      required: ['job_db_id'],
    },
  },
  {
    name: 'aegis_buy_data',
    description: 'Pay for and call a paid x402 service from Aegis own non-custodial Circle agent wallet. Cost is capped per-call by Aegis spending policy (default $0.10 USDC). Returns the service response payload. ALWAYS call aegis_search_marketplace first to find the service URL. Only use when free alternatives are not enough, every call costs the agent real USDC.',
    input_schema: {
      type: 'object' as const,
      properties: {
        service_url: { type: 'string', description: 'Full x402 service URL from aegis_search_marketplace' },
        method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method (default GET). Must match the service inspect output.' },
        data: { type: 'object', description: 'Optional JSON payload for POST requests, matching the service schema' },
      },
      required: ['service_url'],
    },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────────────────
// Each handler calls existing functions DIRECTLY (no HTTP self-call).

async function guardedMoneyTool(
  ctx: AegisContext,
  action: GuardianAction,
  amountStr: string,
  token: string,
  auditAction: string,
  exec: (walletId: string, amount: string) => Promise<Record<string, unknown>>,
  pendingToAddress?: string,
): Promise<{ result: string }> {
  const amount = parseFloat(amountStr);
  if (!isFinite(amount) || amount <= 0) return { result: JSON.stringify({ error: 'Invalid amount' }) };

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, isActive: true } });
  if (!wallet?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
  if (!wallet.isActive) return { result: JSON.stringify({ error: 'Agent wallet disabled' }) };

  const guard = await evaluateAction(ctx.userId, { action, amountUsd: amount, token });

  if (guard.result.decision === 'DENY') {
    await logAudit({ userId: ctx.userId, actor: 'agent', action: `${auditAction}_BLOCKED`, detail: { amount, token, reasons: guard.result.reasons } });
    return { result: JSON.stringify({ blocked: true, decision: 'DENY', reasons: guard.result.reasons }) };
  }

  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    const pendingTx = await prisma.agentTransaction.create({
      data: {
        userId: ctx.userId,
        type: auditAction,
        tokenIn: token,
        tokenOut: token,
        amount: amountStr,
        amountUsd: amount,
        toAddress: pendingToAddress ?? null,
        status: 'PENDING_APPROVAL',
        network: ctx.network,
      },
    });

    await logAudit({ userId: ctx.userId, actor: 'agent', action: `${auditAction}_NEEDS_APPROVAL`, detail: { amount, token, txId: pendingTx.id, reasons: guard.result.reasons } });

    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { telegramChatId: true, telegramLinked: true } });
    let telegramSent = false;
    if (user?.telegramChatId && user.telegramLinked) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const labelMap: Record<string, string> = {
          EARN_DEPOSIT: 'Deposit to Earn vault',
          EARN_WITHDRAW: 'Withdraw from Earn vault',
          GATEWAY_DEPOSIT: 'Deposit to Gateway',
          GATEWAY_SPEND: 'Spend via Gateway',
        };
        const label = labelMap[auditAction] ?? auditAction;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegramChatId,
            parse_mode: 'HTML',
            text: `🔐 <b>Approval required</b>\n\nYour agent wants to:\n\n<b>${label}</b>\n💰 Amount: <b>${amount} ${token}</b>\n\nThis exceeds your approval threshold. Approve to execute or Reject to cancel.`,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve_tx:${pendingTx.id}` },
                { text: '❌ Reject', callback_data: `reject_tx:${pendingTx.id}` },
              ]],
            },
          }),
        }).then(() => { telegramSent = true; }).catch(err => logger.warn('aegis', 'Telegram approval send failed', err));
      }
    }

    return {
      result: JSON.stringify({
        needs_approval: true,
        decision: 'REQUIRE_APPROVAL',
        reasons: guard.result.reasons,
        telegram_sent: telegramSent,
        message: telegramSent
          ? `Approval request sent to your Telegram. Tap Approve there to execute.`
          : `This action requires approval but Telegram is not linked. Please link Telegram in Settings first.`,
      }),
    };
  }

  const out = await exec(wallet.circleWalletId, amountStr);

  await prisma.agentTransaction.create({
    data: {
      userId: ctx.userId,
      type: auditAction,
      tokenIn: token,
      tokenOut: token,
      amount: amountStr,
      amountUsd: amount,
      txHash: (out.txHash as string) ?? null,
      toAddress: pendingToAddress ?? null,
      // BRIDGE is fire-and-forget (PENDING at submit, no txHash); BridgeTransaction is
      // its source of truth. Record PENDING so a later-failed bridge is neither counted
      // as SUCCESS nor charged against the daily limit (which sums status='SUCCESS').
      status: auditAction === 'BRIDGE' ? ((out.status as string) ?? 'PENDING') : 'SUCCESS',
      network: ctx.network,
    },
  }).catch(err => logger.error('audit', 'Failed to log agentTransaction', err));

  await logAudit({ userId: ctx.userId, actor: 'agent', action: `${auditAction}_EXECUTED`, detail: { amount, token, ...out } });
  return { result: JSON.stringify({ success: true, ...out }) };
}

async function guardedTransferTool(
  ctx: AegisContext,
  token: string,
  amount: number,
  toAddress: string,
): Promise<{ result: string }> {
  if (!isFinite(amount) || amount <= 0) {
    return { result: JSON.stringify({ error: 'Invalid amount' }) };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    return { result: JSON.stringify({ error: 'Invalid EVM address. Must be 0x followed by 40 hex characters.' }) };
  }
  const tokenUpper = token.toUpperCase();
  if (!['USDC', 'EURC'].includes(tokenUpper)) {
    return { result: JSON.stringify({ error: 'Only USDC and EURC transfers are supported.' }) };
  }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: ctx.userId },
    select: { circleWalletId: true, isActive: true },
  });
  if (!wallet?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
  if (!wallet.isActive) return { result: JSON.stringify({ error: 'Agent wallet disabled' }) };

  try {
    const { getWalletTokens } = await import('./tokenBalances');
    const wb = await getWalletTokens(ctx.agentAddress);
    const balance = tokenUpper === 'ETH'
      ? wb.ethBalance
      : wb.tokens.find(t => t.symbol.toUpperCase() === tokenUpper)?.balance ?? 0;
    if (balance < amount) {
      return {
        result: JSON.stringify({
          error: `Insufficient balance: you have ${balance.toFixed(4)} ${tokenUpper}, need ${amount} ${tokenUpper}. You're short by ${(amount - balance).toFixed(4)} ${tokenUpper}.`,
          available_balance: balance,
          requested: amount,
          shortfall: amount - balance,
        }),
      };
    }
  } catch (err) {
    logger.warn('aegis', 'Balance pre-check failed, proceeding', err);
  }

  const amountUsd = amount;
  const guard = await evaluateAction(ctx.userId, { action: 'WITHDRAW', amountUsd, token: tokenUpper });

  if (guard.result.decision === 'DENY') {
    await logAudit({
      userId: ctx.userId,
      actor: 'agent',
      action: 'TRANSFER_BLOCKED',
      detail: { amount, token: tokenUpper, toAddress, reasons: guard.result.reasons },
    });
    return { result: JSON.stringify({ blocked: true, decision: 'DENY', reasons: guard.result.reasons }) };
  }

  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    const pendingTx = await prisma.agentTransaction.create({
      data: {
        userId: ctx.userId,
        type: 'WITHDRAW',
        tokenIn: tokenUpper,
        tokenOut: tokenUpper,
        amount: amount.toString(),
        amountUsd,
        toAddress,
        status: 'PENDING_APPROVAL',
        network: ctx.network,
      },
    });

    await logAudit({
      userId: ctx.userId,
      actor: 'agent',
      action: 'TRANSFER_NEEDS_APPROVAL',
      detail: { amount, token: tokenUpper, toAddress, txId: pendingTx.id, reasons: guard.result.reasons },
    });

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { telegramChatId: true, telegramLinked: true },
    });

    let telegramSent = false;
    if (user?.telegramChatId && user.telegramLinked) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const short = `${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegramChatId,
            parse_mode: 'HTML',
            text: `🔐 <b>Approval required</b>\n\nYour agent wants to send:\n\n<b>${amount} ${tokenUpper}</b>\n📍 To: <code>${short}</code>\n\nThis exceeds your approval threshold. Approve to execute or Reject to cancel.`,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve_tx:${pendingTx.id}` },
                { text: '❌ Reject', callback_data: `reject_tx:${pendingTx.id}` },
              ]],
            },
          }),
        }).then(() => { telegramSent = true; }).catch(err => logger.warn('aegis', 'Telegram approval send failed', err));
      }
    }

    return {
      result: JSON.stringify({
        needs_approval: true,
        decision: 'REQUIRE_APPROVAL',
        reasons: guard.result.reasons,
        telegram_sent: telegramSent,
        message: telegramSent
          ? `Approval request sent to your Telegram. Tap Approve there to execute the transfer of ${amount} ${tokenUpper}.`
          : `This transfer requires approval but Telegram is not linked. Please link Telegram in Settings first.`,
      }),
    };
  }

  const { withdrawFromAgentWallet } = await import('./arckit');
  try {
    const out = await withdrawFromAgentWallet(wallet.circleWalletId, tokenUpper, amount, toAddress);

    await prisma.agentTransaction.create({
      data: {
        userId: ctx.userId,
        type: 'WITHDRAW',
        tokenIn: tokenUpper,
        tokenOut: tokenUpper,
        amount: amount.toString(),
        amountUsd,
        txHash: out.txHash || null,
        toAddress,
        status: 'SUCCESS',
        network: ctx.network,
      },
    });

    await logAudit({
      userId: ctx.userId,
      actor: 'agent',
      action: 'TRANSFER_EXECUTED',
      detail: { amount, token: tokenUpper, toAddress, txHash: out.txHash },
    });

    await redis.del(`agent:tokens:${ctx.agentAddress}`).catch(() => {});

    const explorerUrl = explorerTxUrl(out.txHash);
    const shortAddr = `${toAddress.slice(0, 6)}…${toAddress.slice(-4)}`;
    return {
      result: JSON.stringify({
        success: true,
        sent: `${amount} ${tokenUpper}`,
        to: toAddress,
        tx_hash: out.txHash,
        explorer_url: explorerUrl,
        reply_text: `Sent ${amount} ${tokenUpper} to \`${shortAddr}\`\n\n[View on Arcscan](${explorerUrl})`,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: JSON.stringify({ error: `Transfer failed: ${msg}` }) };
  }
}

async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AegisContext,
): Promise<{ result: string; uiAction?: { type: string; data: any } }> {
  try {
    switch (name) {
      case 'get_wallet_balances': {
        const { getWalletTokens } = await import('./tokenBalances');
        const wb = await getWalletTokens(ctx.agentAddress);
        const tokens = wb.tokens
          .filter(t => !t.isSuspicious)
          .map(t => `${t.symbol}: ${t.balance < 0.01 ? t.balance.toFixed(6) : t.balance.toFixed(4)} ($${t.balanceUsd.toFixed(2)})`);
        if (wb.ethBalance > 0.00001) {
          tokens.unshift(`ETH: ${wb.ethBalance.toFixed(6)} ($${(wb.ethBalance * wb.ethPrice).toFixed(2)})`);
        }
        return {
          result: JSON.stringify({
            total_usd: wb.totalUsd.toFixed(2),
            tokens,
            eth_price: wb.ethPrice.toFixed(2),
          }),
        };
      }

      case 'get_recent_transactions': {
        const limit = Math.min(Number(input.limit) || 5, 10);
        const { listAgentTransactions } = await import('./arckit');
        const wallet = await prisma.agentWallet.findUnique({
          where: { userId: ctx.userId },
          select: { circleWalletId: true },
        });
        if (!wallet?.circleWalletId) return { result: JSON.stringify({ error: 'No wallet configured' }) };
        const txs = await listAgentTransactions(wallet.circleWalletId);
        const rows = txs.slice(0, limit).map(t => ({
          type: t.type,
          amount: t.amount,
          token: t.tokenIn,
          status: t.status,
          when: new Date(t.createdAt).toLocaleString(),
        }));
        return { result: JSON.stringify({ transactions: rows, count: rows.length }) };
      }

      case 'find_token': {
        const query = String(input.query || '');
        // Check if it's a contract address
        const { extractContractAddress, verifyByAddress } = await import('./customTokens');
        const addr = extractContractAddress(query);
        if (addr) {
          const info = await verifyByAddress(addr);
          if (info) {
            return {
              result: JSON.stringify({
                found: true, symbol: info.symbol, name: info.name,
                address: addr, price: info.price, holders: info.holders,
                liquidity: info.liquidity, marketCap: info.marketCap,
                isVerified: info.isVerified, volume24h: info.volume24h,
              }),
            };
          }
          return { result: JSON.stringify({ found: false, error: `No valid ERC-20 token at ${addr}` }) };
        }
        // Search by symbol
        const { verifyToken } = await import('./arckit');
        const v = await verifyToken(query.toUpperCase());
        if (v.candidates.length === 0) {
          return { result: JSON.stringify({ found: false, error: `Token "${query}" not found on Arc` }) };
        }
        if (v.candidates.length > 1) {
          return {
            result: JSON.stringify({
              found: true,
              multiple: true,
              count: v.candidates.length,
              candidates: v.candidates.slice(0, 5).map(c => ({
                symbol: c.symbol, name: c.name, address: c.address,
                price: c.price, holders: c.holders, liquidity: c.liquidity,
                marketCap: c.marketCap, isVerified: c.isVerified,
              })),
            }),
            uiAction: {
              type: 'token_select',
              data: {
                fromToken: 'ETH', amount: 0,
                candidates: v.candidates.slice(0, 5).map(c => ({
                  symbol: c.symbol, name: c.name, address: c.address,
                  holders: c.holders, icon: c.icon || '', isVerified: c.isVerified,
                  marketCap: c.marketCap, price: c.price, liquidity: c.liquidity, volume24h: c.volume24h,
                })),
              },
            },
          };
        }
        const best = v.best!;
        return {
          result: JSON.stringify({
            found: true, symbol: best.symbol, name: best.name,
            address: best.address, price: best.price, holders: best.holders,
            liquidity: best.liquidity, marketCap: best.marketCap,
            isVerified: best.isVerified, warnings: best.warnings,
          }),
        };
      }

      case 'get_swap_quote': {
        const from = String(input.from_token).toUpperCase();
        const to = String(input.to_token).toUpperCase();
        const amount = Number(input.amount);
        if (!amount || amount <= 0) return { result: JSON.stringify({ error: 'Invalid amount' }) };

        const { getSuggestedSlippage } = await import('./agentLearning');
        let slippage = ctx.slippage;

        // Auto-adjust slippage from learning data
        try {
          const { verifyToken } = await import('./arckit');
          const v = await verifyToken(to);
          if (v.best?.address) {
            const suggested = await getSuggestedSlippage(v.best.address, slippage);
            if (suggested > slippage) slippage = suggested;
          }
        } catch (err) {
          logger.warn('aegis', 'Slippage auto-adjustment failed', err);
        }

        const quoteWallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true } });
        if (!quoteWallet?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        let quote: { supported: boolean; toAmountEstimate: string | null; fee: string | null; priceImpact: string | null; rate: string | null; minOutput: string | null; error?: string };
        try {
          const { getFxQuote } = await import('./arcFx');
          const r = await getFxQuote(quoteWallet.circleWalletId, from, to, String(amount), Math.round(slippage * 100));
          quote = { supported: true, toAmountEstimate: r.estimatedOut, fee: null, priceImpact: null, rate: r.rate, minOutput: r.minOut };
        } catch (err) {
          return { result: JSON.stringify({ error: err instanceof Error ? err.message : 'Swap quote unavailable' }) };
        }
        const q = quote as any;
        // Resolve concrete token addresses now and bind them into the stored quote.
        // execute_swap will use these verbatim instead of re-running verifyToken,
        // preventing contract rotation between quote and execute.
        let fromAddrBound: string | undefined;
        let fromDecBound: number | undefined;
        let toAddrBound: string | undefined;
        let toDecBound: number | undefined;
        try {
          const { resolveToken, verifyToken } = await import('./arckit');
          const fi = await resolveToken(from);
          if (fi) { fromAddrBound = fi.address; fromDecBound = fi.decimals; }
          const ti = await resolveToken(to);
          if (ti) { toAddrBound = ti.address; toDecBound = ti.decimals; }
          else {
            const v = await verifyToken(to);
            if (v.best?.address) { toAddrBound = v.best.address; toDecBound = v.best.decimals; }
          }
        } catch (err) { logger.warn('aegis', 'Failed to bind resolved addresses to quote', err); }
        await redis.setex(`swap-confirm:${ctx.userId}`, 60, JSON.stringify({
          fromToken: from, toToken: to, amount: input.amount, createdAt: Date.now(),
          fromAddress: fromAddrBound, fromDecimals: fromDecBound,
          toAddress: toAddrBound, toDecimals: toDecBound,
        }));

        return {
          result: JSON.stringify({
            from_token: from, to_token: to, amount,
            estimated_output: quote.toAmountEstimate,
            rate: q.rate || null,
            min_output: q.minOutput || null,
            fee: quote.fee,
            price_impact: quote.priceImpact,
            slippage,
          }),
          uiAction: {
            type: 'confirm_swap',
            data: {
              fromToken: from, toToken: to, amount, slippage,
              toAmountEstimate: quote.toAmountEstimate,
              rate: q.rate, minOutput: q.minOutput,
              fee: quote.fee, priceImpact: quote.priceImpact,
            },
          },
        };
      }

      case 'execute_swap': {
        const from = String(input.from_token).toUpperCase();
        const to = String(input.to_token).toUpperCase();
        const amount = Number(input.amount);
        if (!amount || amount <= 0) return { result: JSON.stringify({ error: 'Invalid amount' }) };

        // Spending guardrails, blocked/allowed token enforcement
        const guardWallet = await prisma.agentWallet.findUnique({
          where: { userId: ctx.userId },
          select: { blockedTokens: true, allowedTokens: true },
        });
        if (guardWallet) {
          if (guardWallet.blockedTokens.map((t: string) => t.toUpperCase()).includes(to)) {
            return { result: JSON.stringify({ error: `Token ${to} is on your blocked list. Remove it in Settings → Guardrails to trade it.` }) };
          }
          if (guardWallet.allowedTokens.length > 0 && !guardWallet.allowedTokens.map((t: string) => t.toUpperCase()).includes(to)) {
            return { result: JSON.stringify({ error: `Token ${to} is not in your allowed tokens list. Add it in Settings → Guardrails or clear the allowlist.` }) };
          }
        }

        // Atomic swap lock, prevents concurrent swap execution for same user
        const swapLockKey = `swap-lock:${ctx.userId}`;
        const swapLockAcquired = await redis.set(swapLockKey, '1', 'EX', 120, 'NX');
        if (!swapLockAcquired) {
          return { result: JSON.stringify({ success: false, error: 'A swap is already in progress. Please wait a moment.' }) };
        }
        try {

        // Safety checks
        const { getWalletTokens } = await import('./tokenBalances');
        const wb = await getWalletTokens(ctx.agentAddress);
        const fromBal = from === 'ETH'
          ? wb.ethBalance
          : wb.tokens.find(t => t.symbol.toUpperCase() === from)?.balance ?? 0;
        if (amount > fromBal * 1.001) {
          return { result: JSON.stringify({ error: `Insufficient balance: you have ${fromBal.toFixed(6)} ${from}, need ${amount}` }) };
        }

        // Server-side confirmation gate: require a recent quote
        const quoteKey = `swap-confirm:${ctx.userId}`;
        const recentQuote = await redis.get(quoteKey);
        if (!recentQuote) {
          return { result: JSON.stringify({ success: false, error: 'Please get a swap quote first before executing. Say "swap X TOKEN to TOKEN" to see a quote.' }), uiAction: undefined };
        }
        const quoteData = JSON.parse(recentQuote);
        if (quoteData.createdAt && Date.now() - quoteData.createdAt < 3000) {
          return { result: JSON.stringify({ success: false, error: 'Please wait for the user to review the quote before executing.' }) };
        }
        // Bind execute params to the exact quote the user reviewed, blocks prompt-injection
        // that mutates from/to/amount between quote and execute.
        if (
          String(quoteData.fromToken).toUpperCase() !== from ||
          String(quoteData.toToken).toUpperCase() !== to ||
          Math.abs(Number(quoteData.amount) - amount) > 0.0001
        ) {
          await redis.del(quoteKey);
          return { result: JSON.stringify({ success: false, error: 'Swap parameters do not match the quote. Request a new quote.' }), uiAction: undefined };
        }
        await redis.del(quoteKey); // one-time use

        // Enforce swap limits, value the input token at its live USD rate
        const swapAmount = Number(input.amount);
        const { getTokenUsdValue } = await import('./fxHedge');
        const swapUsd = await getTokenUsdValue(from, swapAmount);

        // Block if price couldn't be determined (safety first)
        if (swapUsd <= 0) {
          return { result: JSON.stringify({ success: false, error: `Could not determine USD value for ${from}. Cannot verify swap limits. Try again.` }), uiAction: undefined };
        }

        // Per-transaction limit
        if (swapUsd > ctx.maxTxSizeUsd) {
          return { result: JSON.stringify({ success: false, error: `Swap value ~$${swapUsd.toFixed(2)} exceeds your max transaction limit of $${ctx.maxTxSizeUsd}. Adjust in Settings.` }), uiAction: undefined };
        }

        // Guardian approval threshold
        const swapGuard = await evaluateAction(ctx.userId, { action: 'WITHDRAW', amountUsd: swapUsd, token: from });
        if (swapGuard.result.decision === 'REQUIRE_APPROVAL') {
          await logAudit({ userId: ctx.userId, actor: 'agent', action: 'SWAP_NEEDS_APPROVAL', detail: { from, to, amount, swapUsd, reasons: swapGuard.result.reasons } });

          // Create PENDING_APPROVAL record and send Telegram - same flow as send/earn
          const pendingTx = await prisma.agentTransaction.create({
            data: {
              userId: ctx.userId,
              type: 'SWAP',
              tokenIn: from, tokenOut: to,
              amount: String(amount),
              amountUsd: swapUsd,
              status: 'PENDING_APPROVAL',
              network: ctx.network,
            },
          });

          const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { telegramChatId: true, telegramLinked: true } });
          let telegramSent = false;
          if (user?.telegramChatId && user.telegramLinked) {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: user.telegramChatId,
                  parse_mode: 'HTML',
                  text: `🔐 <b>Swap approval required</b>\n\nYour agent wants to swap:\n\n<b>${amount} ${from} → ${to}</b>\n💰 Value: ~<b>$${swapUsd.toFixed(2)}</b>\n⚠️ Exceeds your $${swapGuard.policy.approvalThresholdUsd} approval threshold.\n\nApprove or reject below:`,
                  reply_markup: {
                    inline_keyboard: [[
                      { text: '✅ Approve', callback_data: `approve_tx:${pendingTx.id}` },
                      { text: '❌ Reject', callback_data: `reject_tx:${pendingTx.id}` },
                    ]],
                  },
                }),
              }).then(() => { telegramSent = true; }).catch(err => logger.warn('aegis', 'Telegram swap approval send failed', err));
            }
          }

          return {
            result: JSON.stringify({
              success: false,
              needs_approval: true,
              tx_id: pendingTx.id,
              telegram_sent: telegramSent,
              reasons: swapGuard.result.reasons,
              message: telegramSent
                ? `Swap of ${amount} ${from} → ${to} (~$${swapUsd.toFixed(2)}) needs approval. Telegram sent to your linked account - tap Approve there to execute.`
                : `Swap of ${amount} ${from} → ${to} (~$${swapUsd.toFixed(2)}) needs Guardian approval but Telegram is not linked. Link Telegram in Settings or raise your threshold.`,
            }),
            uiAction: undefined,
          };
        }

        // Daily spending limit enforcement
        try {
          const { prisma } = await import('../lib/prisma');
          const todayStart = new Date();
          todayStart.setUTCHours(0, 0, 0, 0);
          const todayTxs = await prisma.agentTransaction.findMany({
            where: { userId: ctx.userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
            select: { amountUsd: true },
          });
          const dailyTotal = todayTxs.reduce((sum, tx) => sum + (tx.amountUsd ?? 0), 0);
          if (dailyTotal + swapUsd > ctx.dailyLimitUsd) {
            return { result: JSON.stringify({ success: false, error: `Daily limit reached. Today's total: $${dailyTotal.toFixed(2)} + this swap ~$${swapUsd.toFixed(2)} exceeds your $${ctx.dailyLimitUsd} daily limit.` }), uiAction: undefined };
          }
        } catch (err) {
          logger.warn('swap', 'Daily limit check failed, proceeding with per-tx limit only', err);
        }

        // Scam check
        try {
          const { getTokenReputation } = await import('./agentLearning');
          const { verifyToken } = await import('./arckit');
          const v = await verifyToken(to);
          if (v.best?.address) {
            const rep = await getTokenReputation(v.best.address);
            if (rep?.flags?.includes('scam_suspected')) {
              return { result: JSON.stringify({ error: `Swap blocked: ${to} is flagged as suspected scam` }) };
            }
          }
        } catch (err) {
          logger.error('security', 'Scam detection failed for swap token', err);
        }

        // Execute via the live Circle Swap Kit (arcFx)
        const execWallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true } });
        if (!execWallet?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        const { executeFxSwap } = await import('./arcFx');
        const fxResult = await executeFxSwap(execWallet.circleWalletId, from, to, String(amount), Math.round(ctx.slippage * 100));
        const result = {
          txHash: fxResult.txHash,
          fromAmount: `${amount} ${from}`,
          toAmount: `${fxResult.amountOut ?? '?'} ${to}`,
        };

        // Persist to agentTransaction so daily-limit queries count this swap.
        try {
          const { prisma: prismaClient } = await import('../lib/prisma');
          await prismaClient.agentTransaction.create({
            data: {
              userId: ctx.userId, type: 'SWAP',
              tokenIn: from, tokenOut: to,
              amount: amount.toFixed(6),
              amountUsd: swapUsd,
              txHash: result.txHash ?? null,
              status: 'SUCCESS',
              network: ctx.network,
            },
          });
        } catch (err) { logger.error('audit', 'Failed to log aegis swap transaction', err); }

        // Log to learning system
        try {
          const { logSwapEvent } = await import('./agentLearning');
          const { verifyToken } = await import('./arckit');
          const v = await verifyToken(to);
          await logSwapEvent('swap_success', {
            fromToken: from, toToken: to, toContract: v.best?.address,
            amount, slippage: ctx.slippage, txHash: result.txHash, userId: ctx.userId,
          });
        } catch (err) {
          logger.warn('learning', 'Failed to log swap event', err);
        }

        // Clear cache for dashboard refresh
        try {
          await redis.del(`agent:tokens:${ctx.agentAddress}`);
          await redis.del(`agent:history:${ctx.agentAddress}`);
        } catch {}

        return {
          result: JSON.stringify({
            success: true,
            from_amount: result.fromAmount,
            to_amount: result.toAmount,
            tx_hash: result.txHash,
            explorer_url: explorerTxUrl(result.txHash),
          }),
        };

        } finally {
          await redis.del(swapLockKey);
        }
      }

      case 'create_price_rule': {
        const token = String(input.token).toUpperCase();
        const condition = String(input.condition) as 'ABOVE' | 'BELOW';
        const threshold = Number(input.threshold);
        const name = String(input.name || `${token} ${condition} $${threshold}`);

        if (!['ABOVE', 'BELOW'].includes(condition)) {
          return { result: JSON.stringify({ error: 'Condition must be ABOVE or BELOW' }) };
        }
        if (!threshold || threshold <= 0) {
          return { result: JSON.stringify({ error: 'Threshold must be a positive number' }) };
        }

        // Check limits
        const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { plan: true } });
        const ruleCount = await prisma.rule.count({ where: { userId: ctx.userId } });
        const maxRules = user?.plan === 'PRO' ? 100 : 10;
        if (ruleCount >= maxRules) {
          return { result: JSON.stringify({ error: `Rule limit reached (${maxRules}). Upgrade to PRO for more.` }) };
        }

        // Check duplicate
        const existing = await prisma.rule.findFirst({
          where: { userId: ctx.userId, tokenSymbol: token, condition, threshold },
        });
        if (existing) {
          return { result: JSON.stringify({ error: 'This rule already exists', rule_name: existing.name }) };
        }

        await prisma.rule.create({
          data: {
            userId: ctx.userId, name, token, tokenSymbol: token,
            condition, threshold, cooldownMin: 60, isActive: true,
          },
        });
        return { result: JSON.stringify({ success: true, name, token, condition, threshold }) };
      }

      case 'update_settings': {
        const updates: Record<string, unknown> = {};
        if (input.max_tx_size_usd !== undefined) {
          const v = Number(input.max_tx_size_usd);
          if (v > 0 && v <= 100_000) updates.maxTxSizeUsd = v;
          else if (v > 100_000) return { result: JSON.stringify({ success: false, error: 'Max transaction size cannot exceed $100,000' }) };
        }
        if (input.daily_limit_usd !== undefined) {
          const v = Number(input.daily_limit_usd);
          if (v > 0 && v <= 1_000_000) updates.dailyLimitUsd = v;
          else if (v > 1_000_000) return { result: JSON.stringify({ success: false, error: 'Daily limit cannot exceed $1,000,000' }) };
        }
        // Enforce maxTx <= daily
        const newMax = (updates.maxTxSizeUsd as number) ?? ctx.maxTxSizeUsd;
        const newDaily = (updates.dailyLimitUsd as number) ?? ctx.dailyLimitUsd;
        if (newMax > newDaily) {
          return { result: JSON.stringify({ success: false, error: `Max per-swap ($${newMax}) cannot exceed daily limit ($${newDaily})` }) };
        }
        if (Object.keys(updates).length > 0) {
          await prisma.agentWallet.update({ where: { userId: ctx.userId }, data: updates });
        }
        if (input.auto_mode !== undefined) {
          await prisma.user.update({ where: { id: ctx.userId }, data: { autoMode: !!input.auto_mode } });
        }
        return { result: JSON.stringify({ success: true, updated: { ...updates, ...(input.auto_mode !== undefined ? { autoMode: input.auto_mode } : {}) } }) };
      }

      case 'get_yield_rates': {
        const { getYieldRates, formatYieldsForAI } = await import('./yieldRates');
        const rates = await getYieldRates();
        return { result: formatYieldsForAI(rates) };
      }

      case 'show_amount_options': {
        const from = String(input.from_token).toUpperCase();
        const to = String(input.to_token).toUpperCase();
        const bal = Number(input.balance);
        return {
          result: JSON.stringify({
            message: `Select how much ${from} to swap to ${to}:`,
            options: [10, 25, 50, 100].map(p => ({
              label: `${p}%`,
              amount: (bal * p / 100).toFixed(6),
              from_token: from,
              to_token: to,
            })),
          }),
          uiAction: {
            type: 'token_select',
            data: {
              fromToken: from, toToken: to, amount: bal,
              candidates: [10, 25, 50, 100].map(p => ({
                symbol: `${p}%`, name: `${(bal * p / 100).toFixed(6)} ${from}`,
                address: '', holders: 0, icon: '', isVerified: true, marketCap: null,
                price: bal * p / 100, liquidity: 0, volume24h: 0,
              })),
            },
          },
        };
      }

      case 'check_token_safety': {
        const token = String(input.token).toUpperCase();
        const { verifyToken } = await import('./arckit');
        const { getReputationWarnings, getSuggestedSlippage } = await import('./agentLearning');
        const v = await verifyToken(token);
        if (!v.best) {
          return { result: JSON.stringify({ found: false, error: `Token "${token}" not found` }) };
        }
        const warnings = await getReputationWarnings(v.best.address);
        const suggestedSlippage = await getSuggestedSlippage(v.best.address, 0.5);
        return {
          result: JSON.stringify({
            token: v.best.symbol, name: v.best.name, address: v.best.address,
            holders: v.best.holders, liquidity: v.best.liquidity,
            isVerified: v.best.isVerified,
            warnings: [...(v.best.warnings || []), ...warnings],
            suggested_slippage: suggestedSlippage,
            verdict: warnings.length === 0 && v.best.isVerified ? 'SAFE' : warnings.some(w => /scam/i.test(w)) ? 'DANGEROUS' : 'CAUTION',
          }),
        };
      }

      case 'create_limit_order': {
        const { createLimitOrder } = await import('./limitOrders');
        const { classifySwapRoute } = await import('./swapRouter');
        const fromToken = String(input.from_token).toUpperCase();
        const toToken = String(input.to_token).toUpperCase();
        const amount = String(input.amount);
        const triggerPrice = Number(input.trigger_price);
        const direction = String(input.direction) as 'ABOVE' | 'BELOW';
        const slippage = input.slippage !== undefined ? Number(input.slippage) : undefined;
        const expiresAt = input.expires_hours ? new Date(Date.now() + Number(input.expires_hours) * 3_600_000) : undefined;

        if (!['ABOVE', 'BELOW'].includes(direction)) {
          return { result: JSON.stringify({ error: 'direction must be ABOVE or BELOW' }) };
        }
        if (triggerPrice <= 0) {
          return { result: JSON.stringify({ error: 'trigger_price must be positive' }) };
        }
        if (classifySwapRoute(fromToken, toToken) === 'UNSUPPORTED') {
          return { result: JSON.stringify({ error: `No swap route for ${fromToken} to ${toToken} on Arc. Supported: USDC<->EURC (FX) and USDC<->USYC (treasury vault).` }) };
        }

        const order = await createLimitOrder({ userId: ctx.userId, fromToken, toToken, amount, triggerPrice, direction, slippage, expiresAt });
        return {
          result: JSON.stringify({
            success: true,
            order_id: order.id,
            summary: `Limit order created: sell ${amount} ${fromToken} → ${toToken} when price ${direction === 'ABOVE' ? '≥' : '≤'} $${triggerPrice}`,
          }),
        };
      }

      case 'list_limit_orders': {
        const { getLimitOrders } = await import('./limitOrders');
        const orders = await getLimitOrders(ctx.userId);
        if (orders.length === 0) {
          return { result: JSON.stringify({ orders: [], message: 'No limit orders found.' }) };
        }
        const summary = orders.map(o => ({
          id: o.id,
          pair: `${o.fromToken} → ${o.toToken}`,
          amount: o.amount,
          trigger: `${o.watchToken} ${o.direction === 'ABOVE' ? '≥' : '≤'} $${o.triggerPrice}`,
          status: o.status,
          created: o.createdAt.toISOString().split('T')[0],
          expires: o.expiresAt ? o.expiresAt.toISOString().split('T')[0] : 'never',
          tx_hash: o.txHash,
        }));
        return { result: JSON.stringify({ orders: summary, total: orders.length }) };
      }

      case 'cancel_limit_order': {
        const { cancelLimitOrder } = await import('./limitOrders');
        const orderId = String(input.order_id);
        const cancelled = await cancelLimitOrder(orderId, ctx.userId);
        if (!cancelled) {
          return { result: JSON.stringify({ success: false, error: 'Order not found or already completed/cancelled.' }) };
        }
        return { result: JSON.stringify({ success: true, message: `Limit order ${orderId} cancelled.` }) };
      }

      case 'create_dca_order': {
        const { createDCAOrder } = await import('./dca');
        const { classifySwapRoute } = await import('./swapRouter');
        const fromToken = String(input.from_token).toUpperCase();
        const toToken = String(input.to_token).toUpperCase();
        const amountPerCycle = String(input.amount_per_cycle);
        const frequency = String(input.frequency) as 'HOURLY' | 'DAILY' | 'WEEKLY';
        const maxRuns = input.max_runs !== undefined ? Number(input.max_runs) : undefined;

        if (!['HOURLY', 'DAILY', 'WEEKLY'].includes(frequency)) {
          return { result: JSON.stringify({ error: 'frequency must be HOURLY, DAILY, or WEEKLY' }) };
        }

        if (classifySwapRoute(fromToken, toToken) === 'UNSUPPORTED') {
          return { result: JSON.stringify({ error: `No swap route for ${fromToken} to ${toToken} on Arc. Supported: USDC<->EURC (FX) and USDC<->USYC (treasury vault).` }) };
        }

        const order = await createDCAOrder({ userId: ctx.userId, fromToken, toToken, amountPerCycle, frequency, maxRuns });
        const freqLabel = frequency === 'HOURLY' ? 'every hour' : frequency === 'DAILY' ? 'every day' : 'every week';
        return {
          result: JSON.stringify({
            success: true,
            order_id: order.id,
            summary: `DCA order created: buy ${toToken} with ${amountPerCycle} ${fromToken} ${freqLabel}${maxRuns ? ` for ${maxRuns} cycles` : ' (unlimited)'}`,
          }),
        };
      }

      case 'list_dca_orders': {
        const { getDCAOrders } = await import('./dca');
        const orders = await getDCAOrders(ctx.userId);
        if (orders.length === 0) {
          return { result: JSON.stringify({ orders: [], message: 'No DCA orders found.' }) };
        }
        const summary = orders.map(o => ({
          id: o.id,
          pair: `${o.fromToken} → ${o.toToken}`,
          amount_per_cycle: `${o.amountPerCycle} ${o.fromToken}`,
          frequency: o.frequency,
          status: o.status,
          runs: `${o.totalRuns}${o.maxRuns ? `/${o.maxRuns}` : ''}`,
          next_run: o.status === 'ACTIVE' ? o.nextRunAt.toISOString() : null,
        }));
        return { result: JSON.stringify({ orders: summary, total: orders.length }) };
      }

      case 'manage_dca_order': {
        const { pauseDCAOrder, resumeDCAOrder, cancelDCAOrder } = await import('./dca');
        const orderId = String(input.order_id);
        const action = String(input.action);
        let ok = false;

        if (action === 'pause') ok = await pauseDCAOrder(orderId, ctx.userId);
        else if (action === 'resume') ok = await resumeDCAOrder(orderId, ctx.userId);
        else if (action === 'cancel') ok = await cancelDCAOrder(orderId, ctx.userId);
        else return { result: JSON.stringify({ error: 'action must be pause, resume, or cancel' }) };

        if (!ok) {
          return { result: JSON.stringify({ success: false, error: `Cannot ${action} order ${orderId}, not found or wrong status.` }) };
        }
        return { result: JSON.stringify({ success: true, message: `DCA order ${orderId} ${action}d.` }) };
      }

      case 'update_guardrails': {
        const wallet = await prisma.agentWallet.findUnique({
          where: { userId: ctx.userId },
          select: { allowedTokens: true, blockedTokens: true, slippagePercent: true },
        });
        if (!wallet) {
          return { result: JSON.stringify({ error: 'Agent wallet not found.' }) };
        }

        const updates: Record<string, unknown> = {};

        if (input.slippage_percent !== undefined) {
          const s = Number(input.slippage_percent);
          if (s < 0.01 || s > 50) return { result: JSON.stringify({ error: 'Slippage must be between 0.01% and 50%' }) };
          updates.slippagePercent = s;
        }

        let allowedTokens = [...wallet.allowedTokens];
        let blockedTokens = [...wallet.blockedTokens];

        if (input.clear_allowlist) allowedTokens = [];
        if (Array.isArray(input.add_to_allowlist)) {
          const add = (input.add_to_allowlist as string[]).map(t => t.toUpperCase());
          allowedTokens = [...new Set([...allowedTokens, ...add])];
        }
        if (Array.isArray(input.remove_from_allowlist)) {
          const rm = (input.remove_from_allowlist as string[]).map(t => t.toUpperCase());
          allowedTokens = allowedTokens.filter(t => !rm.includes(t));
        }
        if (Array.isArray(input.add_to_blocklist)) {
          const add = (input.add_to_blocklist as string[]).map(t => t.toUpperCase());
          blockedTokens = [...new Set([...blockedTokens, ...add])];
        }
        if (Array.isArray(input.remove_from_blocklist)) {
          const rm = (input.remove_from_blocklist as string[]).map(t => t.toUpperCase());
          blockedTokens = blockedTokens.filter(t => !rm.includes(t));
        }

        updates.allowedTokens = allowedTokens;
        updates.blockedTokens = blockedTokens;

        await prisma.agentWallet.update({ where: { userId: ctx.userId }, data: updates });

        return {
          result: JSON.stringify({
            success: true,
            slippage: updates.slippagePercent ?? wallet.slippagePercent,
            allowedTokens,
            blockedTokens,
            message: allowedTokens.length > 0
              ? `Allowlist active: only ${allowedTokens.join(', ')} can be traded.`
              : 'No allowlist restriction.',
          }),
        };
      }

      case 'earn_info': {
        const vault = await getEarnInfo();
        let position: unknown = null;
        const w = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true } });
        if (w?.circleWalletId) { try { position = await getEarnPosition(w.circleWalletId); } catch { /* none */ } }
        return { result: JSON.stringify({ vault, position }) };
      }

      case 'earn_deposit': {
        return await guardedMoneyTool(ctx, 'TRANSFER', String(input.amount), 'USDC', 'EARN_DEPOSIT', async (walletId, amt) => {
          const r = await earnDeposit(walletId, amt);
          return { txHash: r.txHash, explorerUrl: r.explorerUrl, deposited: `${amt} USDC` };
        });
      }

      case 'earn_withdraw': {
        return await guardedMoneyTool(ctx, 'TRANSFER', String(input.amount), 'USDC', 'EARN_WITHDRAW', async (walletId, amt) => {
          const r = await earnWithdraw(walletId, amt);
          return { txHash: r.txHash, explorerUrl: r.explorerUrl, withdrawn: `${amt} USDC` };
        });
      }

      case 'gateway_balance': {
        const w = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true } });
        if (!w?.circleWalletId) return { result: JSON.stringify({ error: 'No agent wallet' }) };
        const bal = await getGatewayBalance(w.circleWalletId);
        return { result: JSON.stringify(bal) };
      }

      case 'gateway_deposit': {
        return await guardedMoneyTool(ctx, 'TRANSFER', String(input.amount), 'USDC', 'GATEWAY_DEPOSIT', async (walletId, amt) => {
          const r = await gatewayDeposit(walletId, amt);
          return { txHash: r.txHash, explorerUrl: r.explorerUrl, deposited: `${amt} USDC` };
        });
      }

      case 'gateway_spend': {
        const toChain = String(input.to_chain);
        const recipient = String(input.recipient);
        return await guardedMoneyTool(ctx, 'GATEWAY_SPEND', String(input.amount), 'USDC', 'GATEWAY_SPEND', async (walletId, amt) => {
          const r = await gatewaySpend(walletId, toChain, recipient, amt);
          return { txHash: r.txHash, explorerUrl: r.explorerUrl, spent: `${amt} USDC -> ${toChain}` };
        }, `${toChain}|${recipient}`);
      }

      case 'list_bridge_chains': {
        const chains = getSupportedChainDetails().filter((c) => c.id !== 'arc-testnet' && c.bridgeSupported);
        return { result: JSON.stringify({ from: 'arc-testnet', chains }) };
      }

      case 'get_bridge_quote': {
        const w = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true } });
        if (!w?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        const toChain = String(input.to_chain || '');
        const amount = String(input.amount || '');
        const speed = (input.transfer_speed === 'SLOW' ? 'SLOW' : 'FAST') as 'FAST' | 'SLOW';
        const quote = await getBridgeQuote(w.circleWalletId, 'arc-testnet', toChain, amount, speed);
        return { result: JSON.stringify(quote) };
      }

      case 'execute_bridge': {
        const toChain = String(input.to_chain || '');
        const amountStr = String(input.amount || '');
        const speed = (input.transfer_speed === 'SLOW' ? 'SLOW' : 'FAST') as 'FAST' | 'SLOW';
        const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, agentAddress: true, isActive: true } });
        if (!wallet?.circleWalletId) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        if (!wallet.isActive) return { result: JSON.stringify({ error: 'Agent wallet disabled' }) };
        const destination = String(input.destination_address || wallet.agentAddress || '');
        return await guardedMoneyTool(ctx, 'BRIDGE', amountStr, 'USDC', 'BRIDGE', async (walletId, amt) => {
          const r = await executeBridge(walletId, ctx.userId, 'arc-testnet', toChain, amt, destination, speed);
          return { bridge_id: r.id, status: r.status, from_chain: r.fromChain, to_chain: r.toChain, amount: r.amount };
        }, `${toChain}|${destination}`);
      }

      case 'get_bridge_progress': {
        const bridgeId = String(input.bridge_id || '');
        if (!bridgeId) return { result: JSON.stringify({ error: 'bridge_id is required' }) };
        const events = await getBridgeProgress(bridgeId);
        return { result: JSON.stringify({ bridge_id: bridgeId, events }) };
      }

      case 'create_autonomous_bridge_rule': {
        const name = String(input.name || '').trim();
        const balanceThreshold = Number(input.balance_threshold_usdc);
        const toChain = String(input.bridge_to_chain || '').trim();
        const amountUsdc = String(input.bridge_amount_usdc || '').trim();
        const destAddress = input.bridge_dest_address ? String(input.bridge_dest_address).trim() : undefined;
        const cooldown = Math.max(30, Math.min(1440, Number(input.cooldown_minutes ?? 60)));

        if (!name) return { result: JSON.stringify({ error: 'name is required' }) };
        if (!isFinite(balanceThreshold) || balanceThreshold <= 0) {
          return { result: JSON.stringify({ error: 'balance_threshold_usdc must be a positive number' }) };
        }
        if (!toChain) return { result: JSON.stringify({ error: 'bridge_to_chain is required (e.g. "base-sepolia")' }) };
        if (!/^\d+(\.\d+)?$/.test(amountUsdc) || parseFloat(amountUsdc) <= 0) {
          return { result: JSON.stringify({ error: 'bridge_amount_usdc must be a positive decimal string' }) };
        }
        if (destAddress && !/^0x[a-fA-F0-9]{40}$/.test(destAddress)) {
          return { result: JSON.stringify({ error: 'bridge_dest_address must be a valid 0x address' }) };
        }

        try {
          const rule = await prisma.rule.create({
            data: {
              userId: ctx.userId,
              name,
              token: 'USDC',
              tokenSymbol: 'USDC',
              condition: 'ABOVE',
              threshold: balanceThreshold,
              cooldownMin: cooldown,
              isActive: true,
              action: 'BRIDGE',
              triggerType: 'BALANCE_USDC_GTE',
              actionConfig: { toChain, amountUsdc, ...(destAddress ? { destAddress } : {}) },
            },
          });
          await logAudit({
            userId: ctx.userId,
            actor: 'agent',
            action: 'AUTONOMOUS_RULE_CREATED',
            detail: { ruleId: rule.id, name, balanceThreshold, toChain, amountUsdc },
          });
          return { result: JSON.stringify({
            success: true,
            rule_id: rule.id,
            name,
            trigger: `USDC balance ≥ ${balanceThreshold}`,
            action: `bridge ${amountUsdc} USDC → ${toChain}`,
            cooldown_minutes: cooldown,
            note: 'Worker checks every minute. Bridge auto-executes only if Guardian policy ALLOWs (within per-tx and daily limits).',
          }) };
        } catch (e) {
          return { result: JSON.stringify({ error: e instanceof Error ? e.message : 'rule creation failed' }) };
        }
      }

      case 'list_my_jobs': {
        const wallet = await prisma.agentWallet.findUnique({
          where: { userId: ctx.userId },
          select: { agentAddress: true },
        });
        const myAddr = wallet?.agentAddress?.toLowerCase() ?? '';
        const jobs = await prisma.job.findMany({
          where: {
            OR: [
              { userId: ctx.userId },
              ...(myAddr ? [
                { clientAddress: { equals: myAddr, mode: 'insensitive' as const } },
                { providerAddress: { equals: myAddr, mode: 'insensitive' as const } },
                { evaluatorAddress: { equals: myAddr, mode: 'insensitive' as const } },
              ] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true, jobId: true, status: true, description: true,
            clientAddress: true, providerAddress: true, evaluatorAddress: true,
            budgetUsdc: true, createdAt: true,
          },
        });
        return { result: JSON.stringify({ count: jobs.length, my_address: myAddr, jobs }) };
      }

      case 'create_job': {
        const wallet = await prisma.agentWallet.findUnique({
          where: { userId: ctx.userId },
          select: { circleWalletId: true, agentAddress: true, isActive: true },
        });
        if (!wallet?.circleWalletId || !wallet.agentAddress) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        if (!wallet.isActive) return { result: JSON.stringify({ error: 'Agent wallet disabled' }) };

        const SELF_TOKENS = new Set(['self', 'me', 'myself', 'mine', 'my-address', 'my_address', 'user']);
        const resolveSelf = (raw: string): string => {
          const lower = raw.trim().toLowerCase();
          if (SELF_TOKENS.has(lower)) return wallet.agentAddress!.toLowerCase();
          return lower;
        };
        const provider = resolveSelf(String(input.provider_address || ''));
        const evaluator = resolveSelf(String(input.evaluator_address || ''));
        const description = String(input.description || '').trim();
        const expiresInHours = Number(input.expires_in_hours ?? 24);
        if (!/^0x[a-f0-9]{40}$/.test(provider)) return { result: JSON.stringify({ error: 'Invalid provider_address (pass full 0x address or "self")' }) };
        if (!/^0x[a-f0-9]{40}$/.test(evaluator)) return { result: JSON.stringify({ error: 'Invalid evaluator_address (pass full 0x address or "self")' }) };
        if (!description || description.length > 500) return { result: JSON.stringify({ error: 'description required (1-500 chars)' }) };
        if (!isFinite(expiresInHours) || expiresInHours <= 0) return { result: JSON.stringify({ error: 'expires_in_hours must be positive' }) };

        const expiredAt = new Date(Date.now() + expiresInHours * 3600_000);
        // Step 1: draft in DB
        const draft = await prisma.job.create({
          data: {
            userId: ctx.userId,
            role: 'CLIENT',
            status: 'DRAFT',
            clientAddress: wallet.agentAddress,
            providerAddress: provider,
            evaluatorAddress: evaluator,
            description,
            expiredAt,
          },
        });
        // Step 2: publish on-chain
        try {
          const r = await createOnchainJob({
            walletId: wallet.circleWalletId,
            walletAddress: wallet.agentAddress,
            providerAddress: provider,
            evaluatorAddress: evaluator,
            expiredAtSec: Math.floor(expiredAt.getTime() / 1000),
            description,
          });
          const updated = await prisma.job.update({
            where: { id: draft.id },
            data: { jobId: r.jobId, createTxHash: r.txHash, status: 'OPEN' },
          });
          await logAudit({ userId: ctx.userId, actor: 'agent', action: 'JOB_CREATED', detail: { jobDbId: updated.id, onchainId: r.jobId, txHash: r.txHash } });
          return { result: JSON.stringify({
            success: true,
            job_db_id: updated.id,
            onchain_job_id: r.jobId,
            status: 'OPEN',
            tx_hash: r.txHash,
            tx_url: explorerTxUrl(r.txHash),
            next_step: 'Provider must call set_job_budget',
          }) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'createJob on-chain failed';
          await prisma.job.update({ where: { id: draft.id }, data: { error: msg } }).catch(() => {});
          return { result: JSON.stringify({ error: msg, job_db_id: draft.id, hint: 'Draft saved but on-chain create failed' }) };
        }
      }

      case 'set_job_budget': {
        const jobDbId = String(input.job_db_id || '');
        const amountUsdc = Number(input.amount_usdc);
        if (!jobDbId) return { result: JSON.stringify({ error: 'job_db_id is required' }) };
        if (!isFinite(amountUsdc) || amountUsdc <= 0) return { result: JSON.stringify({ error: 'amount_usdc must be positive' }) };
        const job = await prisma.job.findUnique({ where: { id: jobDbId } });
        if (!job?.jobId) return { result: JSON.stringify({ error: 'Job not found or not yet on-chain' }) };
        const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, agentAddress: true } });
        if (!wallet?.circleWalletId || !wallet.agentAddress) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        if (wallet.agentAddress.toLowerCase() !== job.providerAddress.toLowerCase()) {
          return { result: JSON.stringify({ error: 'Only the named provider can set budget. Your address does not match.' }) };
        }
        try {
          const r = await setJobBudget(wallet.circleWalletId, job.jobId, amountUsdc);
          await prisma.job.update({ where: { id: job.id }, data: { budgetUsdc: String(amountUsdc), budgetTxHash: r.txHash } });
          await logAudit({ userId: ctx.userId, actor: 'agent', action: 'JOB_BUDGET_SET', detail: { jobDbId: job.id, amount: amountUsdc, txHash: r.txHash } });
          return { result: JSON.stringify({ success: true, tx_hash: r.txHash, tx_url: explorerTxUrl(r.txHash), next_step: 'Client must call fund_job' }) };
        } catch (e) {
          return { result: JSON.stringify({ error: e instanceof Error ? e.message : 'setBudget failed' }) };
        }
      }

      case 'fund_job': {
        const jobDbId = String(input.job_db_id || '');
        if (!jobDbId) return { result: JSON.stringify({ error: 'job_db_id is required' }) };
        const job = await prisma.job.findUnique({ where: { id: jobDbId } });
        if (!job?.jobId) return { result: JSON.stringify({ error: 'Job not found or not yet on-chain' }) };
        if (!job.budgetUsdc) return { result: JSON.stringify({ error: 'Provider has not set budget yet' }) };
        const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, agentAddress: true, isActive: true } });
        if (!wallet?.circleWalletId || !wallet.isActive) return { result: JSON.stringify({ error: 'Agent wallet not configured or disabled' }) };
        if (wallet.agentAddress!.toLowerCase() !== job.clientAddress.toLowerCase()) {
          return { result: JSON.stringify({ error: 'Only the named client can fund. Your address does not match.' }) };
        }
        const amount = parseFloat(job.budgetUsdc);
        return await guardedMoneyTool(ctx, 'TRANSFER', String(amount), 'USDC', 'JOB_FUND', async (walletId) => {
          const approveResult = await approveUsdcForJobs(walletId, amount);
          const fundResult = await fundJob(walletId, job.jobId!);
          await prisma.job.update({ where: { id: job.id }, data: { fundTxHash: fundResult.txHash, status: 'FUNDED' } });
          return {
            success: true,
            approve_tx: approveResult.txHash,
            fund_tx: fundResult.txHash,
            tx_url: explorerTxUrl(fundResult.txHash),
            amount: `${amount} USDC`,
            next_step: 'Provider must submit deliverable',
          };
        });
      }

      case 'submit_job_deliverable': {
        const jobDbId = String(input.job_db_id || '');
        const deliverableText = String(input.deliverable_text || '').trim();
        if (!jobDbId) return { result: JSON.stringify({ error: 'job_db_id is required' }) };
        if (!deliverableText) return { result: JSON.stringify({ error: 'deliverable_text is required' }) };
        const job = await prisma.job.findUnique({ where: { id: jobDbId } });
        if (!job?.jobId) return { result: JSON.stringify({ error: 'Job not found or not yet on-chain' }) };
        if (job.status !== 'FUNDED') return { result: JSON.stringify({ error: `Cannot submit from status ${job.status}; expected FUNDED` }) };
        const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, agentAddress: true } });
        if (!wallet?.circleWalletId || !wallet.agentAddress) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        if (wallet.agentAddress.toLowerCase() !== job.providerAddress.toLowerCase()) {
          return { result: JSON.stringify({ error: 'Only the named provider can submit. Your address does not match.' }) };
        }
        const hash = bytes32FromText(deliverableText);
        try {
          const r = await submitDeliverable(wallet.circleWalletId, job.jobId, hash);
          await prisma.job.update({ where: { id: job.id }, data: { deliverableHash: hash, submitTxHash: r.txHash, status: 'SUBMITTED' } });
          await logAudit({ userId: ctx.userId, actor: 'agent', action: 'JOB_SUBMITTED', detail: { jobDbId: job.id, hash, txHash: r.txHash } });
          return { result: JSON.stringify({ success: true, deliverable_hash: hash, tx_hash: r.txHash, tx_url: explorerTxUrl(r.txHash), next_step: 'Evaluator must call complete_job' }) };
        } catch (e) {
          return { result: JSON.stringify({ error: e instanceof Error ? e.message : 'submit failed' }) };
        }
      }

      case 'complete_job': {
        const jobDbId = String(input.job_db_id || '');
        const reasonText = String(input.reason_text || '').trim();
        if (!jobDbId) return { result: JSON.stringify({ error: 'job_db_id is required' }) };
        if (!reasonText) return { result: JSON.stringify({ error: 'reason_text is required' }) };
        const job = await prisma.job.findUnique({ where: { id: jobDbId } });
        if (!job?.jobId) return { result: JSON.stringify({ error: 'Job not found or not yet on-chain' }) };
        if (job.status !== 'SUBMITTED') return { result: JSON.stringify({ error: `Cannot complete from status ${job.status}; expected SUBMITTED` }) };
        const wallet = await prisma.agentWallet.findUnique({ where: { userId: ctx.userId }, select: { circleWalletId: true, agentAddress: true } });
        if (!wallet?.circleWalletId || !wallet.agentAddress) return { result: JSON.stringify({ error: 'Agent wallet not configured' }) };
        if (wallet.agentAddress.toLowerCase() !== job.evaluatorAddress.toLowerCase()) {
          return { result: JSON.stringify({ error: 'Only the named evaluator can complete. Your address does not match.' }) };
        }
        const hash = bytes32FromText(reasonText);
        try {
          const r = await completeJob(wallet.circleWalletId, job.jobId, hash);
          await prisma.job.update({ where: { id: job.id }, data: { reasonHash: hash, completeTxHash: r.txHash, status: 'COMPLETED' } });
          await logAudit({ userId: ctx.userId, actor: 'agent', action: 'JOB_COMPLETED', detail: { jobDbId: job.id, txHash: r.txHash, budgetReleased: job.budgetUsdc } });
          return { result: JSON.stringify({
            success: true,
            tx_hash: r.txHash,
            tx_url: explorerTxUrl(r.txHash),
            settled: `${job.budgetUsdc} USDC released to provider ${job.providerAddress}`,
          }) };
        } catch (e) {
          return { result: JSON.stringify({ error: e instanceof Error ? e.message : 'complete failed' }) };
        }
      }

      case 'get_job_status': {
        const jobDbId = String(input.job_db_id || '');
        if (!jobDbId) return { result: JSON.stringify({ error: 'job_db_id is required' }) };
        const job = await prisma.job.findUnique({ where: { id: jobDbId } });
        if (!job) return { result: JSON.stringify({ error: 'Job not found' }) };
        let onChain = null;
        if (job.jobId) {
          onChain = await getOnChainJob(job.jobId);
        }
        return { result: JSON.stringify({ job, onChain }) };
      }

      case 'send_usdc': {
        const token = String(input.token || 'USDC').toUpperCase();
        const amount = Number(input.amount);
        const toAddress = String(input.to_address || '');
        return await guardedTransferTool(ctx, token, amount, toAddress);
      }

      case 'aegis_search_marketplace': {
        const keyword = String(input.keyword || '').trim();
        if (!keyword) return { result: JSON.stringify({ error: 'keyword is required' }) };
        const status = await getAegisStatus();
        if (!status.loggedIn) {
          return { result: JSON.stringify({
            error: 'Aegis-wallet not bootstrapped',
            hint: status.message,
            services: [],
          }) };
        }
        try {
          const services = await searchAegisServices(keyword, 10);
          return { result: JSON.stringify({ keyword, count: services.length, services }) };
        } catch (err) {
          return { result: JSON.stringify({ error: err instanceof Error ? err.message : 'search failed', services: [] }) };
        }
      }

      case 'aegis_buy_data': {
        const serviceUrl = String(input.service_url || '').trim();
        if (!serviceUrl) return { result: JSON.stringify({ error: 'service_url is required' }) };
        const status = await getAegisStatus();
        if (!status.loggedIn) {
          return { result: JSON.stringify({
            error: 'Aegis-wallet not bootstrapped',
            hint: 'Operator must run: circle wallet login',
          }) };
        }
        try {
          const r = await aegisPay(serviceUrl, {
            method: input.method as 'GET' | 'POST' | undefined,
            data: input.data as unknown,
          });
          await logAudit({
            userId: ctx.userId,
            actor: 'agent',
            action: r.ok ? 'AEGIS_PAY_OK' : 'AEGIS_PAY_FAIL',
            detail: { serviceUrl, cost: r.cost, txHash: r.txHash, error: r.error },
          });
          return { result: JSON.stringify(r) };
        } catch (err) {
          return { result: JSON.stringify({ error: err instanceof Error ? err.message : 'pay failed' }) };
        }
      }

      default:
        return { result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[aegis] Tool ${name} error:`, msg);
    // Log error to learning system for future improvement
    try {
      const { logSwapEvent } = await import('./agentLearning');
      if (name === 'execute_swap' || name === 'get_swap_quote') {
        await logSwapEvent('swap_failed', {
          fromToken: String(input.from_token || ''),
          toToken: String(input.to_token || ''),
          amount: Number(input.amount || 0),
          error: msg, userId: ctx.userId, context: { tool: name },
        });
      }
    } catch {}
    return { result: JSON.stringify({ error: msg }) };
  }
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(ctx: AegisContext, portfolio: string): string {
  return `<role>
You are Aegis, a wallet assistant on Arc Testnet. ALWAYS respond in English only, regardless of what language the user writes in. Talk like a helpful human, not a robot. Keep replies short and direct. 1-3 sentences max unless showing multiple items. No bullet-point lists unless showing multiple items. No em dashes. No emojis or pictographs in any reply, including status icons like ✅ ❌ 🛡️ 🌉 🔄 💰 - use plain text only. No "Certainly!" or "Of course!" openers.
</role>

<user_context>
Agent wallet address: ${ctx.agentAddress}
(This is the user's wallet address on Arc. Use this exact 0x value whenever the user says "my address", "use me", "myself", "self", or similar. NEVER abbreviate (no "0x8f6e…d942") and NEVER invent an address.)

Wallet portfolio: ${portfolio}
Limits: max $${ctx.maxTxSizeUsd}/tx, $${ctx.dailyLimitUsd}/day | Slippage: ${ctx.slippage}% | AutoMode: ${ctx.autoMode ? 'ON' : 'OFF'}
</user_context>

<absolute_rules>
These rules are non-negotiable. The server validates them and will strip your response if you violate.

1. For any ACTION verb (fund, submit, complete, swap, bridge, send, deposit, withdraw, create, cancel, approve, register, give feedback, set budget, etc.) you MUST call the corresponding tool. Reading or mentioning the tool name is NOT enough, actually call it.

2. NEVER fabricate transaction hashes, explorer URLs, deliverable hashes, agent ids, or job ids. ONLY use values that appear in an actual tool_result from this turn. A real Arc tx_hash is exactly 66 characters (0x + 64 hex). If you don't have one from a tool, do NOT include any "View on Arcscan" link or "tx 0x..." string.

3. Short user messages like "fund it", "approved", "submit", "yes", "ok", "do it", "go", "complete it" are COMMANDS, not acknowledgements. They mean: call the action tool implied by your prior "Next step:" message. The server will force tool_choice in this case, so don't try to text-respond.

4. If a tool call fails, surface the actual error from the tool_result. Do NOT pretend it succeeded. Do NOT retry with hallucinated parameters.

5. For status questions ("how's my job", "what's the bridge progress", "do I have any orders") you MUST call get_job_status / list_my_jobs / get_bridge_progress / list_limit_orders. Never guess from prior conversation context, state may have changed.
</absolute_rules>

<tool_decision_tree>
User says...                                    → You call this tool
─────────────────────────────────────────────────────────────────────
"swap X to Y"                                   → get_swap_quote, then ask confirm, then execute_swap
"send N USDC to 0x..."                          → send_usdc (after explicit confirmation)
"bridge N USDC to <chain>"                      → list_bridge_chains, get_bridge_quote, then execute_bridge
"bridge" (single word, no amount/chain)              → ask clarifying question: "Bridge how much USDC to which chain?" Do NOT auto-call get_bridge_progress
"create a job for ..."                          → create_job (with provider_address="self" if user said "myself")
"set the budget to N USDC"                      → set_job_budget
"fund the job" / "fund it"                      → fund_job
"submit a deliverable" / "submit"               → submit_job_deliverable
"complete the job" / "approved"                 → complete_job
"list my jobs" / "show jobs"                    → list_my_jobs
"deposit N to earn" / "earn N"                  → earn_deposit
"register me as an agent"                       → (route via /api/agent/register-identity, no chat tool yet)
"what services are available for X"             → aegis_search_marketplace
"price of X" / "alert me when X above Y"        → create_price_rule
</tool_decision_tree>

<examples>
<example_1>
User: bridge 10 USDC to Base
Assistant: <calls list_bridge_chains>
<calls get_bridge_quote with to_chain="base-sepolia", amount="10">
Quote: 10 USDC will arrive on Base Sepolia, gas ~0.01 USDC, no protocol fee (Forwarding Service). Should I execute?

User: yes
Assistant: <calls execute_bridge with to_chain="base-sepolia", amount="10">
Bridge submitted. [tx link from tool result] I'll poll progress; ask me anytime.
</example_1>

<example_2>
User: create a job, description "rebalance", I'm provider and evaluator, 1 hour expiry
Assistant: <calls create_job with provider_address="self", evaluator_address="self", description="rebalance", expires_in_hours=1>
Done, job id [from tool], on-chain #[from tool]. [tx link from tool] Next step: as provider, set the budget.

User: 1 USDC
Assistant: <calls set_job_budget with job_db_id=[id], amount_usdc=1>
Budget set. [tx link] Next step: as client, fund the escrow.

User: fund it
Assistant: <calls fund_job with job_db_id=[id]>
Job funded, 1 USDC in escrow. [tx link from tool] Next: as provider, submit a deliverable.
</example_2>

<example_3>
User: how's my bridge doing?
Assistant: <calls get_bridge_progress with bridge_id=[from earlier context]>
Status from chain: [actual events from tool]. (NEVER guess, only repeat what the tool returned.)
</example_3>
</examples>

<behavior_guidelines>
- Balances shown above; do NOT call get_wallet_balances again.
- For swaps: ALWAYS get_swap_quote first, ask confirmation, then execute_swap.
- No amount given: call show_amount_options instead of guessing.
- Unknown token symbol: call find_token first.
- Sending USDC/EURC: ALWAYS require user to paste the full 0x recipient in THIS message. If not, ask explicitly.
- Guardian gates: fund_job, send_usdc, execute_bridge, gateway_spend, earn_deposit/withdraw may return needs_approval=true → tell the user they need to approve on Telegram, do NOT claim success.
- ERC-8183 role checks: create_job is for client. set_job_budget is provider-only. fund_job is client-only. submit_job_deliverable is provider-only. complete_job is evaluator-only. Tool will error if your address doesn't match.
- When a tool returns tx_hash or tx_url, format as markdown: [View on Arcscan](url). Tx hashes have exactly 66 chars, never write shorter ones from your head.
- When a tool result contains a "reply_text" field, output that text VERBATIM. Do not paraphrase.
</behavior_guidelines>`;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────
// The core: send messages to Claude → if Claude calls a tool → run it → send result back → repeat

const MAX_TOOL_ROUNDS = 6; // Safety limit to prevent infinite loops

export async function runAegis(
  userMessage: string,
  ctx: AegisContext,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<AegisResponse> {
  // Build portfolio context (lightweight, from cache if possible)
  let portfolioCtx = 'No wallet data available.';
  try {
    const { getWalletTokens } = await import('./tokenBalances');
    const wb = await getWalletTokens(ctx.agentAddress);
    const lines = wb.tokens
      .filter(t => !t.isSuspicious)
      .map(t => `- ${t.symbol}: ${t.balance < 0.01 ? t.balance.toFixed(6) : t.balance.toFixed(4)} ($${t.balanceUsd.toFixed(2)})`);
    if (wb.ethBalance > 0.00001) {
      lines.unshift(`- ETH: ${wb.ethBalance.toFixed(6)} ($${(wb.ethBalance * wb.ethPrice).toFixed(2)})`);
    }
    portfolioCtx = `Total: ~$${wb.totalUsd.toFixed(2)}\n${lines.join('\n') || 'No tokens'}`;
  } catch {}

  // Rules context
  const rules = await prisma.rule.findMany({
    where: { userId: ctx.userId, isActive: true },
    select: { name: true, tokenSymbol: true, condition: true, threshold: true },
  });
  if (rules.length > 0) {
    portfolioCtx += `\n\nActive rules (${rules.length}):\n` +
      rules.map(r => `- "${r.name}": ${r.tokenSymbol} ${r.condition} $${r.threshold}`).join('\n');
  }

  const systemPrompt = buildSystemPrompt(ctx, portfolioCtx);

  // Build messages for Claude
  const messages: Anthropic.MessageParam[] = [
    ...chatHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Collected UI actions from tool calls
  let uiActions: string[] = [];
  let ruleCreated = false;
  let settingsUpdated = false;
  let swapCompleted = false;
  const toolsUsed: ToolTrace[] = [];
  // All real tx hashes (66-char hex) that any tool actually returned this turn.
  // Anything in the final text that's NOT in this set is a fabrication.
  const realTxHashes = new Set<string>();

  // ─── Force-tool-choice for short affirmatives ───────────────────────────
  // If the last assistant message proposed a clear next step AND the user
  // replied with a short affirmative ("yes", "ok", "approved", "do it", etc.),
  // force Claude to actually call a tool instead of producing free text.
  const lastAssistant = [...chatHistory].reverse().find(m => m.role === 'assistant')?.content ?? '';
  const isShortAffirmative = /^(yes|ok|okay|approved?|do it|go|proceed|sure|fund|fund it|submit|submit it|complete|complete it|create|create it|sign|sign it|confirm|confirmed|y|👍)\.?\s*$/i.test(userMessage.trim());
  const proposedToolByPhrase: Record<string, string> = {
    'fund the job': 'fund_job',
    'fund the escrow': 'fund_job',
    'as the client': 'fund_job',
    'submit a deliverable': 'submit_job_deliverable',
    'submit the deliverable': 'submit_job_deliverable',
    'as provider': 'submit_job_deliverable',
    'as the provider': 'submit_job_deliverable',
    'complete the job': 'complete_job',
    'as evaluator': 'complete_job',
    'as the evaluator': 'complete_job',
    'release the': 'complete_job',
    'set the budget': 'set_job_budget',
    'set budget': 'set_job_budget',
    'execute the swap': 'execute_swap',
    'execute swap': 'execute_swap',
    'execute the bridge': 'execute_bridge',
    'send the usdc': 'send_usdc',
  };
  let forcedTool: { type: 'tool'; name: string } | null = null;
  if (isShortAffirmative && lastAssistant) {
    const haystack = lastAssistant.toLowerCase();
    for (const [phrase, tool] of Object.entries(proposedToolByPhrase)) {
      if (haystack.includes(phrase)) { forcedTool = { type: 'tool', name: tool }; break; }
    }
    if (forcedTool) console.log(`[aegis] Forcing tool_choice=${forcedTool.name} (short affirmative after "Next step")`);
  }

  // Agent loop. Claude may call multiple tools
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: AEGIS_TOOLS,
      ...(round === 0 && forcedTool ? { tool_choice: forcedTool } : {}),
      messages,
    });

    const cached = (response as any).usage?.cache_read_input_tokens || 0;
    console.log(`[aegis] Round ${round + 1} | stop=${response.stop_reason} | in:${response.usage.input_tokens} out:${response.usage.output_tokens} cached:${cached}`);

    // Check if Claude wants to use a tool
    if (response.stop_reason === 'tool_use') {
      // Find all tool_use blocks in the response
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use'
      );

      // Add Claude's response (with text + tool_use) to messages
      messages.push({ role: 'assistant', content: response.content as any });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`[aegis] Tool: ${toolBlock.name}(${JSON.stringify(toolBlock.input)})`);
        const { result, uiAction } = await handleTool(toolBlock.name, toolBlock.input, ctx);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result,
        });

        // Collect every real 66-char hex (tx hashes) from this tool result.
        // Anything in the model's final text not in this set is fabrication.
        const hashesInResult = result.match(/0x[a-fA-F0-9]{64}/g) || [];
        for (const h of hashesInResult) realTxHashes.add(h.toLowerCase());

        // Track for UI indicator
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(result); } catch { /* ignore */ }
        const ok = !(parsed as { error?: unknown; blocked?: unknown; needs_approval?: unknown }).error
          && !(parsed as { blocked?: unknown }).blocked;
        const trace: ToolTrace = {
          name: toolBlock.name,
          input: toolBlock.input,
          ok,
        };
        const cost = (parsed as { cost?: string }).cost;
        if (cost) trace.cost = String(cost);
        const services = (parsed as { services?: unknown[]; count?: number }).services;
        if (Array.isArray(services)) trace.summary = `${services.length} services`;
        const txHash = (parsed as { txHash?: string }).txHash;
        if (txHash) trace.summary = `tx ${String(txHash).slice(0, 10)}…`;
        const blocked = (parsed as { blocked?: unknown }).blocked;
        if (blocked) trace.summary = 'blocked by guardian';
        const needsApproval = (parsed as { needs_approval?: unknown }).needs_approval;
        if (needsApproval) trace.summary = 'needs org approval';
        toolsUsed.push(trace);

        // Track UI actions
        if (uiAction) {
          if (uiAction.type === 'confirm_swap') {
            uiActions = ['confirm_swap', 'cancel', JSON.stringify(uiAction.data)];
          } else if (uiAction.type === 'token_select') {
            uiActions = ['token_select', JSON.stringify(uiAction.data)];
          }
        }

        // Track side effects
        if (toolBlock.name === 'create_price_rule') {
          const r = JSON.parse(result);
          if (r.success) ruleCreated = true;
        }
        if (toolBlock.name === 'update_settings') {
          const r = JSON.parse(result);
          if (r.success) settingsUpdated = true;
        }
        if (toolBlock.name === 'execute_swap') {
          const r = JSON.parse(result);
          if (r.success) swapCompleted = true;
        }
      }

      // Send tool results back to Claude
      messages.push({ role: 'user', content: toolResults });
      continue; // Loop. Claude will respond with text or more tool calls
    }

    // Claude responded with text (no more tools), we're done
    const textBlocks = response.content.filter(b => b.type === 'text');
    let text = textBlocks.map(b => (b as any).text).join('\n').trim();

    // ─── Anti-hallucination guardrail v2 ────────────────────────────────────
    // Cross-reference EVERY tx hash mentioned in the text against the set of
    // real hashes returned by tools this turn. Any hash not in realTxHashes
    // is a fabrication, applies even when toolsUsed.length > 0 (hybrid
    // hallucination: 1 real tool + 1 fake success message).
    const hashesInText = (text.match(/0x[a-fA-F0-9]{64}/g) || []).map(h => h.toLowerCase());
    const fakeHashes = hashesInText.filter(h => !realTxHashes.has(h));
    const explorerLinkPattern = /\[?[Vv]iew on (?:Arcscan|the explorer)\]?\(?https?:\/\/[^\s)]+\)?|https?:\/\/(?:testnet\.)?arcscan\.app\/tx\/0x[a-fA-F0-9]+/g;
    const successPattern = /\b(job (?:funded|completed|created|submitted)|deliverable submitted|usdc (?:released|escrowed|moved)|bridge submitted|swap (?:executed|completed))\b/i;

    const noToolHallucination = toolsUsed.length === 0 &&
      (/0x[a-fA-F0-9]{40,}/.test(text) || explorerLinkPattern.test(text) || successPattern.test(text));
    const hybridHallucination = toolsUsed.length > 0 && fakeHashes.length > 0;

    if (noToolHallucination || hybridHallucination) {
      console.warn(`[aegis] HALLUCINATION DETECTED, noTool=${noToolHallucination} hybrid=${hybridHallucination} fakeHashes=${fakeHashes.length} realHashes=${realTxHashes.size}`);
      const stripped = text
        .replace(explorerLinkPattern, '[explorer-link-stripped]')
        .replace(new RegExp(fakeHashes.length > 0 ? fakeHashes.map(h => h).join('|') : '0x[a-fA-F0-9]{40,}', 'g'), '[hash-stripped]')
        .replace(/\s+/g, ' ')
        .trim();
      if (hybridHallucination) {
        text = `${stripped}\n\n⚠️ Note: I included one or more fake transaction references above (stripped). The real actions I just performed are shown in the tool badges. Please verify before acting on this message.`;
      } else {
        text = `⚠️ I almost claimed an action succeeded without calling the relevant tool. The fake draft was stripped to prevent showing you a fake transaction. Please retry with an explicit command (e.g. "use complete_job to complete it") and I will actually call the tool.\n\n(Stripped draft: "${stripped.slice(0, 200)}${stripped.length > 200 ? '…' : ''}")`;
      }
    }

    return {
      text: text || 'Done.',
      actions: uiActions.length > 0 ? uiActions : undefined,
      ruleCreated,
      settingsUpdated,
      swapCompleted,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  }

  // Safety: if we hit max rounds, return what we have
  return { text: 'I completed the analysis. Let me know if you need anything else.', toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined };
}
