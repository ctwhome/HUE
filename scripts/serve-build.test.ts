import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryPaths: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('serves from an immutable snapshot when the source build is replaced', async () => {
	const root = await mkdtemp(join(tmpdir(), 'hue-serve-build-test-'));
	temporaryPaths.push(root);
	const build = join(root, 'build');
	await mkdir(join(build, 'client'), { recursive: true });
	await writeFile(join(build, 'client', 'asset.txt'), 'current asset');
	await writeFile(
		join(build, 'index.js'),
		`console.log('snapshot-ready');
await Bun.sleep(100);
console.log(await Bun.file(new URL('./client/asset.txt', import.meta.url)).text());`
	);

	const process = Bun.spawn([join(import.meta.dir, 'serve-build.sh'), build, Bun.which('bun')!], {
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const reader = process.stdout.getReader();
	const first = await reader.read();
	expect(new TextDecoder().decode(first.value)).toContain('snapshot-ready');
	await rm(build, { recursive: true });
	const rest = await new Response(new ReadableStream({
		start(controller) {
			void (async () => {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					controller.enqueue(chunk.value);
				}
				controller.close();
			})();
		}
	})).text();

	expect(await process.exited).toBe(0);
	expect(rest).toContain('current asset');
});
