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

test('selection resets staging before restoring and never restores over post-load edits', () => {
	const source = readFileSync(new URL('./navigation.svelte.ts', import.meta.url), 'utf8')
		.split('openSession = async')[1]
		.split('addWorkflow =')[0];
	expect(source.indexOf('this.effects.clearSession();')).toBeLessThan(
		source.indexOf('this.effects.restoreDraft();')
	);
	expect(source.match(/this.effects.restoreDraft\(\)/g)).toHaveLength(1);
	expect(source).toMatch(
		/if \(changingSession\) \{\s*this.effects.clearSession\(\);\s*this.effects.restoreDraft\(\);/
	);
	const controller = readFileSync(
		new URL('./session-controller.svelte.ts', import.meta.url),
		'utf8'
	);
	expect(
		controller.split('applyLoadedSession:')[1].split('focusNotificationTarget:')[0]
	).not.toContain('messageState.clear()');
});

test('creation continuation does not restore over edits after runtime setup', () => {
	const source = readFileSync(new URL('./navigation.svelte.ts', import.meta.url), 'utf8')
		.split('createSession = async')[1]
		.split('openSession = async')[0];
	const continuation = source.split('await this.effects.applyCreatedSession')[1];
	expect(continuation).not.toContain('this.effects.restoreDraft()');
	expect(continuation).toContain('this.isCurrentSessionSelection(selection)');
});

test('loaded Session polling follows current delivery instead of the old detail snapshot', () => {
	const source = readFileSync(new URL('./navigation.svelte.ts', import.meta.url), 'utf8')
		.split('openSession = async')[1]
		.split('addWorkflow =')[0];
	expect(source).toContain('includes(this.effects.getDelivery())');
	expect(source).not.toContain('if (body.activeTurn');
});
