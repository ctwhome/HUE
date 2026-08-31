import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(import.meta.dir, path), 'utf8');

test('user turns stick, clamp to two lines, and expand or collapse in place', () => {
	const conversation = read('Conversation.svelte');
	const styles = read('../../../styles/conversation-composer.css');
	const paneStyles = read('../../../styles/session-panes.css');

	expect(conversation).toContain("'Expand full message'");
	expect(conversation).toContain('aria-label="Collapse message"');
	expect(conversation).toContain('expandedUserMessages.includes(messageKey)');
	expect(styles).toMatch(/\.transcript article\.user\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
	expect(styles).toMatch(/\.user-message-content\.collapsed\s*\{[^}]*-webkit-line-clamp:\s*2/s);
	expect(styles).toContain('max-height: 40dvh');
	expect(conversation).toContain('rounded-br-md');
	expect(conversation).toContain('class:has-images={Boolean(message.images?.length)}');
	expect(styles).toMatch(/article\.user > \.message-identity\s*\{[^}]*display:\s*none/s);
	expect(styles).toMatch(
		/\.user-message-body\.collapsed\.has-images \.message-images\s*\{[^}]*max-height:\s*72px/s
	);
	expect(styles).toContain('var(--chat-surface, var(--background))');
	expect(paneStyles).toMatch(
		/\.session-pane-grid\[data-pane-count='1'\]\s*\{[^}]*--chat-surface:\s*var\(--card\)/s
	);
});
