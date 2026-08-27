import { expect, test } from 'bun:test';
import { fileSourceLanguage, highlightFileSource } from './file-source-highlight';

test('maps common developer filenames to Prism languages', () => {
	expect(fileSourceLanguage('src/app.ts')).toBe('typescript');
	expect(fileSourceLanguage('component.tsx')).toBe('tsx');
	expect(fileSourceLanguage('package.json')).toBe('json');
	expect(fileSourceLanguage('.env.example')).toBe('bash');
	expect(fileSourceLanguage('Makefile')).toBe('makefile');
	expect(fileSourceLanguage('Component.svelte')).toBe('markup');
	expect(fileSourceLanguage('Dockerfile')).toBe('docker');
});

test('highlights source safely and keeps unknown text escaped', () => {
	expect(highlightFileSource('const answer: number = 42;', 'app.ts')).toContain(
		'<span class="token keyword">const</span>'
	);
	expect(highlightFileSource('# Title', 'README.md')).toContain('syntax-heading');
	expect(highlightFileSource('<script>alert(1)</script>', 'notes.custom')).toBe(
		'&lt;script&gt;alert(1)&lt;/script&gt;'
	);
});
