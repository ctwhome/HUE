import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectFavicon } from './project-icon';

test('finds supported favicon files within a Project', () => {
	for (const [extension, mime] of [
		['png', 'image/png'],
		['jpg', 'image/jpeg'],
		['avif', 'image/avif'],
		['svg', 'image/svg+xml']
	]) {
		const root = mkdtempSync(join(tmpdir(), 'hue-project-icon-'));
		try {
			mkdirSync(join(root, 'assets'));
			writeFileSync(join(root, 'assets', `favicon.${extension}`), 'icon');
			expect(findProjectFavicon(root)).toBe(`data:${mime};base64,aWNvbg==`);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});
