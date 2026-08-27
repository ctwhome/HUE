import { afterEach, expect, test } from 'bun:test';
import {
	linkSync,
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	truncateSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectFiles } from './project-files';

const roots: string[] = [];

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'hue-project-files-'));
	roots.push(root);
	mkdirSync(join(root, 'src'));
	writeFileSync(join(root, 'README.md'), '# HUE\n\nProject notes.');
	writeFileSync(join(root, 'src', 'main.ts'), 'export const hue = true;\n');
	return { root, files: new ProjectFiles(root) };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('indexes a bounded tree and searches paths without leaking ignored depth', () => {
	const { root, files } = fixture();
	mkdirSync(join(root, 'src', 'z-deep'));
	writeFileSync(join(root, 'src', 'z-deep', 'hidden.ts'), 'hidden');
	writeFileSync(join(root, 'src', 'visible.ts'), 'visible');

	const tree = files.tree({ maxEntries: 3, maxDepth: 1 });
	expect(tree.entries.map(({ path }) => path)).toEqual(['README.md', 'src', 'src/main.ts']);
	expect(tree.truncated).toBe(true);
	expect(files.search('MAIN', { maxResults: 2 }).results.map(({ path }) => path)).toEqual([
		'src/main.ts'
	]);
});

test('rejects decoded traversal, absolute paths, and NULs', () => {
	const { files } = fixture();
	for (const path of [
		'../secret',
		'src/../../secret',
		'/etc/passwd',
		'src\\..\\secret',
		'src/evil\0name'
	]) {
		expect(() => files.preview(path)).toThrow('Invalid Project file path');
	}
});

test('accepts already-decoded filesystem names containing literal percent sequences', () => {
	const { root, files } = fixture();
	writeFileSync(join(root, '%notes.txt'), 'percent');
	writeFileSync(join(root, '%2e%2e'), 'literal encoded-looking name');

	expect(files.preview('%notes.txt').content).toBe('percent');
	expect(files.preview('%2e%2e')).toMatchObject({ name: '%2e%2e', size: 28 });
});

test('fails closed for symlink and hardlink escapes', () => {
	const { root, files } = fixture();
	const outside = mkdtempSync(join(tmpdir(), 'hue-project-outside-'));
	roots.push(outside);
	writeFileSync(join(outside, 'secret.txt'), 'private');
	symlinkSync(outside, join(root, 'escape'));
	linkSync(join(outside, 'secret.txt'), join(root, 'borrowed.txt'));

	expect(() => files.preview('escape/secret.txt')).toThrow('Symbolic links are not allowed');
	expect(() => files.preview('borrowed.txt')).toThrow('Hard-linked files are not allowed');
	expect(() => files.save('borrowed.txt', 'changed')).toThrow('Hard-linked files are not allowed');
	expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('private');
});

test('keeps opened parent directory boundary when its path is swapped', () => {
	const { root, files } = fixture();
	const outside = mkdtempSync(join(tmpdir(), 'hue-project-race-'));
	roots.push(outside);
	writeFileSync(join(outside, 'target.txt'), 'outside');

	files._testBeforeLeafOpen = () => {
		files._testBeforeLeafOpen = undefined;
		rmSync(join(root, 'src'), { recursive: true });
		symlinkSync(outside, join(root, 'src'));
	};
	expect(() => files.save('src/target.txt', 'inside')).toThrow();
	expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('outside');
});

test('fails closed when the trusted Project root path is replaced', () => {
	const { root, files } = fixture();
	const moved = `${root}-moved`;
	roots.push(moved);
	renameSync(root, moved);
	mkdirSync(root);
	writeFileSync(join(root, 'README.md'), 'replacement root');
	expect(() => files.preview('README.md')).toThrow('Project root changed');
});

test('uses atomic saves and rejects stale optimistic concurrency tokens', () => {
	const { root, files } = fixture();
	const first = files.preview('README.md');
	expect(first.kind).toBe('markdown');
	writeFileSync(join(root, 'README.md'), 'external edit');

	expect(() => files.save('README.md', 'lost edit', first.version!)).toThrow(
		'File changed outside HUE'
	);
	const current = files.preview('README.md');
	const saved = files.save('README.md', 'kept edit', current.version!);
	expect(saved.version).not.toBe(current.version);
	expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('kept edit');
	expect(files.tree().entries.some(({ name }) => name.startsWith('.hue-write-'))).toBe(false);
});

test('atomic save preserves existing executable mode and gives new files safe defaults', () => {
	const { root, files } = fixture();
	chmodSync(join(root, 'README.md'), 0o755);
	const current = files.preview('README.md');

	files.save('README.md', '#!/bin/sh\necho HUE\n', current.version!);
	files.save('new.txt', 'new');

	expect(statSync(join(root, 'README.md')).mode & 0o777).toBe(0o755);
	expect(statSync(join(root, 'new.txt')).mode & 0o777).toBe(0o600);
});

test('does not overwrite an external edit racing an atomic save', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	files._testBeforeMutation = () => {
		files._testBeforeMutation = undefined;
		writeFileSync(join(root, 'README.md'), 'racing external edit');
	};
	expect(() => files.save('README.md', 'HUE edit', current.version!)).toThrow(
		'File changed outside HUE'
	);
	expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('racing external edit');
});

test('requires exact recursive-delete impact confirmation', () => {
	const { root, files } = fixture();
	writeFileSync(join(root, 'src', 'second.ts'), 'two');
	const impact = files.deleteImpact('src');
	expect(impact).toMatchObject({ path: 'src', files: 2, directories: 1 });
	expect(impact.manifest.map(({ path }) => path)).toEqual(['', 'main.ts', 'second.ts']);
	expect(impact.manifest[1]).toMatchObject({
		path: 'main.ts',
		type: 'file',
		size: expect.any(Number),
		mtimeNs: expect.any(String),
		ctimeNs: expect.any(String),
		device: expect.any(String),
		inode: expect.any(String),
		hash: expect.stringMatching(/^[a-f0-9]{64}$/)
	});
	expect(() => files.remove('src', 'delete src')).toThrow('Delete confirmation does not match');
	files.remove('src', impact.confirmation);
	expect(() => files.preview('src/main.ts')).toThrow('Project file not found');
});

test('restores a quarantined same-size replacement when recursive manifest changed', () => {
	const { root, files } = fixture();
	const target = join(root, 'src', 'main.ts');
	const impact = files.deleteImpact('src');
	const replacement = 'x'.repeat(readFileSync(target).byteLength);
	files._testBeforeMutation = () => {
		files._testBeforeMutation = undefined;
		writeFileSync(target, replacement);
	};

	expect(() => files.remove('src', impact.confirmation)).toThrow(
		'Delete confirmation does not match current manifest'
	);
	expect(readFileSync(target, 'utf8')).toBe(replacement);
	expect(files.tree().entries.some(({ name }) => name.startsWith('.hue-delete-'))).toBe(false);
});

test('fails closed when selected root ctime changes before quarantine', () => {
	const { root, files } = fixture();
	const impact = files.deleteImpact('src');
	files._testBeforeMutation = () => {
		files._testBeforeMutation = undefined;
		chmodSync(join(root, 'src'), 0o700);
	};

	expect(() => files.remove('src', impact.confirmation)).toThrow(
		'Delete confirmation does not match current manifest'
	);
	expect(files.tree().entries.some(({ path }) => path === 'src/main.ts')).toBe(true);
});

test('streams large file metadata and ranges without requiring a content hash', async () => {
	const { root, files } = fixture();
	expect(files.metadata('README.md').version).toBeNull();
	const previewPath = join(root, 'large-preview.txt');
	writeFileSync(previewPath, 'HUE');
	truncateSync(previewPath, ProjectFiles.MAX_WRITE_BYTES + 1);
	expect(files.preview('large-preview.txt')).toMatchObject({
		version: null,
		concurrency: 'unavailable-file-exceeds-hash-limit',
		content: null
	});
	const path = join(root, 'large.bin');
	writeFileSync(path, 'HUE');
	truncateSync(path, ProjectFiles.MAX_HASH_BYTES + 1);

	const metadata = files.metadata('large.bin');
	expect(metadata).toMatchObject({
		size: ProjectFiles.MAX_HASH_BYTES + 1,
		version: null,
		concurrency: 'unavailable-file-exceeds-hash-limit'
	});
	const content = files.content('large.bin', { start: 0, end: 2 });
	expect('data' in content).toBe(false);
	expect(new TextDecoder().decode(await new Response(content.stream).arrayBuffer())).toBe('HUE');
});

test('closes streamed file descriptors when a reader cancels', async () => {
	const { files } = fixture();
	let closes = 0;
	files._testContentClosed = () => closes++;
	const reader = files.content('README.md').stream.getReader();
	await reader.read();
	await reader.cancel();
	expect(closes).toBe(1);
});

test('rechecks destructive impact after atomically quarantining the selected path', () => {
	const { root, files } = fixture();
	const impact = files.deleteImpact('src');
	files._testBeforeMutation = () => {
		files._testBeforeMutation = undefined;
		writeFileSync(join(root, 'src', 'late.txt'), 'late');
	};
	expect(() => files.remove('src', impact.confirmation)).toThrow(
		'Delete confirmation does not match'
	);
	expect(readFileSync(join(root, 'src', 'late.txt'), 'utf8')).toBe('late');
});

test('restores quarantine without deleting a late entry created through a bound directory', () => {
	const { root, files } = fixture();
	const impact = files.deleteImpact('src');
	(
		files as ProjectFiles & {
			_testAfterDeleteManifestValidation?: (
				createAt: (path: string, content: string) => void
			) => void;
		}
	)._testAfterDeleteManifestValidation = (createAt) => createAt('late.txt', 'late through fd');

	expect(() => files.remove('src', impact.confirmation)).toThrow(
		'Delete failed because file changed; quarantined content restored'
	);
	expect(readFileSync(join(root, 'src', 'late.txt'), 'utf8')).toBe('late through fd');
	expect(files.tree().entries.some(({ name }) => name.startsWith('.hue-delete-'))).toBe(false);
});

test('does not move a file changed during optimistic validation', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	files._testBeforeMutation = () => {
		files._testBeforeMutation = undefined;
		writeFileSync(join(root, 'README.md'), 'racing external edit');
	};
	expect(() => files.move('README.md', 'MOVED.md', current.version!)).toThrow(
		'File changed outside HUE'
	);
	expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('racing external edit');
});

test('rolls an exchanged move back before destination placeholder cleanup after validation fault', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	(
		files as ProjectFiles & {
			_testMoveFault?: (
				stage: 'validation' | 'cleanup' | 'rollback' | 'placeholder-cleanup'
			) => void;
		}
	)._testMoveFault = (stage) => {
		if (stage === 'validation') throw new Error('injected move validation fault');
	};

	expect(() => files.move('README.md', 'MOVED.md', current.version!)).toThrow(
		'Move rolled back after injected move validation fault'
	);
	expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# HUE\n\nProject notes.');
	expect(() => readFileSync(join(root, 'MOVED.md'), 'utf8')).toThrow();
});

test('reconciles an exchanged move after cleanup fault without unlinking destination original', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	(
		files as ProjectFiles & {
			_testMoveFault?: (
				stage: 'validation' | 'cleanup' | 'rollback' | 'placeholder-cleanup'
			) => void;
		}
	)._testMoveFault = (stage) => {
		if (stage === 'cleanup') {
			rmSync(join(root, 'README.md'));
			throw new Error('injected move cleanup fault');
		}
	};

	expect(() => files.move('README.md', 'MOVED.md', current.version!)).toThrow(
		'Move completed; original retained at destination; source placeholder cleanup failed'
	);
	expect(readFileSync(join(root, 'MOVED.md'), 'utf8')).toBe('# HUE\n\nProject notes.');
	expect(() => readFileSync(join(root, 'README.md'), 'utf8')).toThrow();
});

test('retains sole original at destination and reports reconciliation when move rollback fails', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	(
		files as ProjectFiles & {
			_testMoveFault?: (
				stage: 'validation' | 'cleanup' | 'rollback' | 'placeholder-cleanup'
			) => void;
		}
	)._testMoveFault = (stage) => {
		if (stage === 'validation') throw new Error('injected move validation fault');
		if (stage === 'rollback') throw new Error('injected move rollback fault');
	};

	expect(() => files.move('README.md', 'MOVED.md', current.version!)).toThrow(
		'Move rollback failed; original retained at destination'
	);
	expect(readFileSync(join(root, 'MOVED.md'), 'utf8')).toBe('# HUE\n\nProject notes.');
});

test('restores original before reporting destination placeholder cleanup failure', () => {
	const { root, files } = fixture();
	const current = files.preview('README.md');
	(
		files as ProjectFiles & {
			_testMoveFault?: (
				stage: 'validation' | 'cleanup' | 'rollback' | 'placeholder-cleanup'
			) => void;
		}
	)._testMoveFault = (stage) => {
		if (stage === 'validation') throw new Error('injected move validation fault');
		if (stage === 'placeholder-cleanup')
			throw new Error('injected destination placeholder cleanup fault');
	};

	expect(() => files.move('README.md', 'MOVED.md', current.version!)).toThrow(
		'Move rolled back; original restored at source; destination placeholder cleanup failed'
	);
	expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# HUE\n\nProject notes.');
	expect(statSync(join(root, 'MOVED.md')).size).toBe(0);
});

test('classifies previews and artifacts honestly with provenance', () => {
	const { root, files } = fixture();
	writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	writeFileSync(join(root, 'unknown.bin'), Buffer.from([0, 1, 2, 3]));
	writeFileSync(join(root, 'verification.json'), '{"passed":false}');

	expect(files.preview('image.png')).toMatchObject({ kind: 'image', mime: 'image/png' });
	expect(files.preview('unknown.bin')).toMatchObject({
		kind: 'binary',
		mime: 'application/octet-stream',
		content: null
	});
	expect(files.artifacts()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: 'README.md', classification: 'source' }),
			expect.objectContaining({
				path: 'verification.json',
				classification: 'verification',
				verified: false,
				provenance: 'Filename heuristic; contents not independently verified'
			})
		])
	);
});

test('previews common developer files and unknown UTF-8 text without treating binary as text', () => {
	const { root, files } = fixture();
	for (const [name, content] of [
		['.env', 'API_URL=http://localhost:3000\n'],
		['.env.example', 'API_URL=\n'],
		['Makefile', 'build:\n\tbun run build\n'],
		['.gitignore', 'node_modules\n'],
		['config.custom', 'enabled=true\n'],
		['app.js', 'export default true;\n'],
		['types.ts', 'export type ID = string;\n'],
		['package.json', '{"private":true}\n']
	] as const)
		writeFileSync(join(root, name), content);
	writeFileSync(join(root, 'unknown.data'), Buffer.from([0, 1, 2, 3]));

	for (const name of [
		'.env',
		'.env.example',
		'Makefile',
		'.gitignore',
		'config.custom',
		'app.js',
		'types.ts',
		'package.json'
	])
		expect(files.preview(name)).toMatchObject({
			kind: expect.stringMatching(/^(text|code)$/),
			content: expect.any(String)
		});
	expect(files.preview('unknown.data')).toMatchObject({ kind: 'binary', content: null });
});

test('enforces preview, write, upload, and search limits', () => {
	const { files } = fixture();
	expect(() => files.save('too-big.txt', 'x'.repeat(ProjectFiles.MAX_WRITE_BYTES + 1))).toThrow(
		'File exceeds write limit'
	);
	expect(() => files.search('x'.repeat(ProjectFiles.MAX_QUERY_LENGTH + 1))).toThrow(
		'Search query is too long'
	);
	expect(() =>
		files.upload('upload.bin', new Uint8Array(ProjectFiles.MAX_UPLOAD_BYTES + 1))
	).toThrow('Upload exceeds size limit');
});
