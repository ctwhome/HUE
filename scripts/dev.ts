import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const prepare = spawnSync('bun', ['run', 'site:prepare'], {
	cwd: root,
	stdio: 'inherit'
});

if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const docs = spawnSync('bunx', ['astro', 'dev'], { cwd: root, stdio: 'inherit' });
if (docs.status !== 0) process.exit(docs.status ?? 1);

const app = spawn('bun', ['run', 'dev'], {
	cwd: join(root, 'apps/workspace'),
	stdio: 'inherit'
});

let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	app.kill();
	spawnSync('bunx', ['astro', 'dev', 'stop'], { cwd: root, stdio: 'inherit' });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const exitCode = await new Promise<number>((resolve, reject) => {
	app.once('error', reject);
	app.once('exit', (code) => resolve(code ?? 1));
});
stop();
process.exit(exitCode);
