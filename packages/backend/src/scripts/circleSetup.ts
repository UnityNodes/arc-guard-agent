import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets';

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
let CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

if (!CIRCLE_API_KEY) {
  console.error('Set CIRCLE_API_KEY in packages/backend/.env first (get it from Circle Console -> Keys).');
  process.exit(1);
}

async function main() {
  let generatedSecret = false;

  if (!CIRCLE_ENTITY_SECRET) {
    CIRCLE_ENTITY_SECRET = crypto.randomBytes(32).toString('hex');
    generatedSecret = true;
    console.log('Generated a new entity secret. Registering it with Circle...');

    const recoveryDir = path.resolve(__dirname, '../..');
    const reg = await registerEntitySecretCiphertext({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
      recoveryFileDownloadPath: recoveryDir,
    });
    if (!reg.data?.recoveryFile) {
      console.error('Entity secret registration failed:', JSON.stringify(reg));
      process.exit(1);
    }
    console.log(`Entity secret registered. Recovery file saved into: ${recoveryDir} (recovery_file_*.dat)`);
    console.log('Keep that recovery file safe - it is the only way to recover your wallets.');
  } else {
    console.log('Using existing CIRCLE_ENTITY_SECRET from .env (assumed already registered).');
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });

  console.log('Creating Circle wallet set for Guard Agent AI...');
  const result = await client.createWalletSet({ name: 'guard-agent-wallets' });
  const walletSetId = result.data?.walletSet?.id;

  if (!walletSetId) {
    console.error('Failed to create wallet set:', JSON.stringify(result));
    process.exit(1);
  }

  console.log('\nSetup complete. Add the following to packages/backend/.env:\n');
  if (generatedSecret) {
    console.log(`CIRCLE_ENTITY_SECRET=${CIRCLE_ENTITY_SECRET}`);
  }
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log('\nThen restart the backend.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
