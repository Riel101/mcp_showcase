import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Node 24 watch mode still watches a missing --env-file-if-exists path,
// causing the supervisor to exit before its application child can start.
const args = [
  ...(existsSync('.env') ? ['--env-file=.env'] : []),
  '--import', 'tsx', '--watch', 'src/server/index.ts', '--dev',
];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', error => {
  console.error('Could not start the development server:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
