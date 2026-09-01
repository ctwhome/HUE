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

test('unknown delivery explains that Hermes may still be working', () => {
	const composer = read('Composer.svelte');

	expect(composer).toContain('Delivery unconfirmed · Hermes may still be working');
});

test('chat activity uses an attributed reduced-motion-safe 3x3 matrix loader', () => {
	const conversation = read('Conversation.svelte');
	const styles = read('../../../styles/conversation-composer.css');
	const notices = readFileSync(
		join(import.meta.dir, '../../../../../THIRD_PARTY_NOTICES.md'),
		'utf8'
	);

	expect(conversation).toContain('class="turn-activity-matrix"');
	expect(conversation).toContain('[2, 1, 2, 1, 0, 1, 2, 1, 2]');
	expect(styles).toContain('@keyframes turn-activity-echo');
	expect(styles).toMatch(/prefers-reduced-motion:[^{]+\{[^}]*\.turn-activity-matrix/s);
	expect(notices).toContain('zzzzshawn/matrix');
});

test('the current task is a floating pill with its plan position and title', () => {
	const currentTask = read('CurrentTask.svelte');
	const styles = read('../../../styles/thinking-task.css');

	expect(currentTask).toContain('plan.indexOf(summary.entry) + 1');
	expect(currentTask).toContain('{taskNumber} - {summary.entry.content}');
	expect(styles).toMatch(/\.current-task\s*\{[^}]*position:\s*absolute[^}]*right:\s*8px/s);
	expect(styles).toMatch(/\.task-trigger\s*\{[^}]*border-radius:\s*999px/s);
});
