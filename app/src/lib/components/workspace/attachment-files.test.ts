import { expect, test } from 'bun:test';
import { readAttachmentFiles } from './attachment-files';

test('preflight rejects unsupported, oversized and aggregate files before FileReader', async () => {
	let reads = 0;
	Reflect.set(
		globalThis,
		'FileReader',
		class {
			readAsDataURL() {
				reads++;
				throw new Error('read');
			}
		}
	);
	for (const [file, staged] of [
		[{ name: 'large.txt', type: 'text/plain', size: 6 * 1024 * 1024 }, 0],
		[{ name: 'bad.exe', type: 'application/octet-stream', size: 10 }, 0],
		[{ name: 'notes.txt', type: 'text/plain', size: 10 }, 40 * 1024 * 1024]
	] as const) {
		const result = await readAttachmentFiles([file as File], staged);
		expect(result.errors).toHaveLength(1);
	}
	expect(reads).toBe(0);
});
