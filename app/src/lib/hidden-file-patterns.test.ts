import { expect, test } from 'bun:test';
import { isFilePathHidden } from './hidden-file-patterns';

test('matches exact names and wildcard file types one pattern per line', () => {
	const patterns = '.DS_Store\n*.log\n*.tmp';
	expect(isFilePathHidden('.DS_Store', patterns)).toBe(true);
	expect(isFilePathHidden('app/.DS_Store', patterns)).toBe(true);
	expect(isFilePathHidden('logs/hue-start.log', patterns)).toBe(true);
	expect(isFilePathHidden('README.md', patterns)).toBe(false);
});

test('hiding a folder or path pattern hides all descendants', () => {
	expect(isFilePathHidden('node_modules/pkg/index.js', 'node_modules')).toBe(true);
	expect(isFilePathHidden('app/build/client.js', 'app/build')).toBe(true);
	expect(isFilePathHidden('docs/build-notes.md', 'app/build')).toBe(false);
});
