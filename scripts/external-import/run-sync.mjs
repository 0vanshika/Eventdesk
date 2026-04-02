import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
const nodeModulesPath = path.join(__dirname, 'node_modules');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!existsSync(envPath)) {
  console.error(`Missing .env file at ${envPath}`);
  console.error('Create that file first, then run this command again.');
  process.exit(1);
}

if (!existsSync(nodeModulesPath)) {
  console.log('Installing importer dependencies...');
  run('npm', ['install', '--no-audit', '--no-fund']);
}

const forwardedArgs = process.argv.slice(2);
const importerArgs = forwardedArgs.length
  ? forwardedArgs
  : ['--source=unstop', '--max-urls=50', '--since-hours=168', '--verbose'];

run('node', ['src/index.js', ...importerArgs]);
