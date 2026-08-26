import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('opening a Session restores its scoped draft before awaiting the Session request', () => {
	const source = readFileSync(new URL('./navigation.svelte.ts', import.meta.url), 'utf8');
	const selection = source.indexOf(
		'this.selectedSession = session;',
		source.indexOf('openSession =')
	);
	const restore = source.indexOf('this.effects.restoreDraft();', selection);
	const request = source.indexOf('await this.effects.api<SessionLoad>', selection);

	expect(selection).toBeGreaterThan(-1);
	expect(restore).toBeGreaterThan(selection);
	expect(restore).toBeLessThan(request);
});
