import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('accepted cancellation remains a distinct busy state until an authoritative event settles it', () => {
	const source = readFileSync(new URL('./message-state.svelte.ts', import.meta.url), 'utf8');
	const stop = source.slice(source.indexOf('stopTurn = async'), source.indexOf('sendText = async'));
	const accepted = stop.indexOf("this.options.session.delivery = 'cancelling';");

	expect(accepted).toBeGreaterThan(stop.indexOf("method: 'POST'"));
});

test('work mode locks and completions are scoped to captured selection', () => {
	const source = readFileSync(new URL('./session-controller.svelte.ts', import.meta.url), 'utf8');
	expect(source).toContain('navigation.isCurrentSessionSelection(workModeSelection)');
	expect(source).toContain(
		'if (selection && navigation.isCurrentSessionSelection(selection)) workModeChanging = false'
	);
	expect(source.split('get workModeChanging()')[1].split('},')[0]).toContain(
		'isCurrentSessionSelection(workModeSelection)'
	);
});
