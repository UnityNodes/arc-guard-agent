import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { execSync } = require('child_process');

readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=');
  if (eq < 1) return;
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
  if (k) process.env[k] = v;
});

const isPortOpen = (port) => new Promise(resolve => {
  const s = new net.Socket();
  s.setTimeout(1000);
  s.connect(port, 'localhost', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});

const pgAlreadyRunning = await isPortOpen(5432);

if (!pgAlreadyRunning) {
  const DATA_DIR = path.join(__dirname, '.pg-data');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'guardagent',
    password: 'guardagent',
    port: 5432,
    persistent: true,
  });
  if (!existsSync(DATA_DIR)) {
    console.log('[dev] Initialising PostgreSQL...');
    await pg.initialise();
  }
  console.log('[dev] Starting PostgreSQL...');
  await pg.start();
  try { await pg.createDatabase('guardagent'); } catch {}
  process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
  process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
} else {
  console.log('[dev] PostgreSQL already running on port 5432');
}

process.env.DATABASE_URL = 'postgresql://guardagent:guardagent@localhost:5432/guardagent';
console.log('[dev] Running Prisma db push...');
execSync('npx prisma db push --schema prisma/schema.prisma --accept-data-loss', {
  stdio: 'inherit', cwd: __dirname, env: process.env, shell: true,
});
console.log('[dev] Schema ready. Starting backend...');

execSync('npx ts-node-dev --respawn --transpile-only src/index.ts', {
  stdio: 'inherit', cwd: __dirname, env: process.env, shell: true,
});
