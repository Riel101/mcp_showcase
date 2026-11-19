import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Exercise the real supervisor and module-loader IPC without needing a port.
for (const withEnv of [false, true]) {
  test(`dev watcher starts and reloads ${withEnv ? 'with' : 'without'} optional .env`, { timeout: 15000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'forme-watch-'));
    mkdirSync(join(directory, 'src/server'), { recursive: true });
    symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    if (withEnv) writeFileSync(join(directory, '.env'), 'FORME_WATCH_TEST_VALUE=loaded\n');
    const entry = join(directory, 'src/server/index.ts');
    const source = (version: number) => `import { basename } from 'node:path'; console.log('READY:${version}:' + (process.env.FORME_WATCH_TEST_VALUE || 'absent') + ':' + basename('/forme')); setInterval(() => {}, 1000);\n`;
    writeFileSync(entry, source(1));
    const env = { ...process.env };
    delete env.FORME_WATCH_TEST_VALUE;
    const child = spawn(process.execPath, [resolve('scripts/dev.mjs')], { cwd: directory, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    async function expect(marker: string) {
      const deadline = Date.now() + 5000;
      while (!output.includes(marker) && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(output.includes(marker), `Missing ${marker}:\n${output}`);
      assert.doesNotMatch(output, /EPIPE|ENOENT|Unhandled 'error'/);
    }
    try {
      await expect(`READY:1:${withEnv ? 'loaded' : 'absent'}:forme`);
      writeFileSync(entry, source(2));
      await expect(`READY:2:${withEnv ? 'loaded' : 'absent'}:forme`);
    } finally {
      if (child.pid) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {} }
      await exited;
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
