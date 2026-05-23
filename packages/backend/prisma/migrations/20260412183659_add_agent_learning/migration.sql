-- CreateTable
CREATE TABLE "AgentLearning" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "fromToken" TEXT,
    "toToken" TEXT,
    "toContract" TEXT,
    "amount" DOUBLE PRECISION,
    "slippage" DOUBLE PRECISION,
    "error" TEXT,
    "txHash" TEXT,
    "userId" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenReputation" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastSlippage" DOUBLE PRECISION,
    "avgSlippage" DOUBLE PRECISION,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenReputation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentLearning_event_idx" ON "AgentLearning"("event");

-- CreateIndex
CREATE INDEX "AgentLearning_toContract_idx" ON "AgentLearning"("toContract");

-- CreateIndex
CREATE INDEX "AgentLearning_createdAt_idx" ON "AgentLearning"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenReputation_address_key" ON "TokenReputation"("address");

-- CreateIndex
CREATE INDEX "TokenReputation_symbol_idx" ON "TokenReputation"("symbol");
