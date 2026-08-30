import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');

test('the floating delivery status toggles thinking details without a toolbar trigger', () => {
	const composer = read('Composer.svelte');
	const thinkingDialog = read('ThinkingDialog.svelte');
	const styles = read('../../../styles/thinking-task.css');

	expect(composer).toContain('class="composer-delivery');
	expect(composer).toContain('aria-controls={`${instanceId}-thinking`}');
	expect(composer).toContain('onclick={toggleThinking}');
	expect(composer).toContain("delivery || (thinkingTimeline.length ? 'activity' : '')");
	expect(composer).toContain('!deliveryButton?.contains(target)');
	expect(composer).toContain('!composerActivity?.contains(target)');
	expect(thinkingDialog).not.toContain('thinking-trigger');
	expect(thinkingDialog).toContain('transition:fly={{ y: 6, duration: 140 }}');
	expect(styles).toContain('.composer-delivery:focus-visible');
});
