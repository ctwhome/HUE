import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');

test('conversation and composer expose one structured review-context loop', () => {
	const conversation = read('Conversation.svelte');
	const composer = read('Composer.svelte');

	expect(conversation).toContain('Add selected text to prompt');
	expect(conversation).toContain('onquote');
	expect(composer).toContain('Pending review context');
	expect(composer).toContain('Review comment');
	expect(composer).toContain('Remove review context');
	expect(composer).toContain('maxlength={reviewContextLimits.maxCommentChars}');
});

test('sent user messages keep captured source and comment separate', () => {
	const conversation = read('Conversation.svelte');

	expect(conversation).toContain('Captured source');
	expect(conversation).toContain('<summary>');
	expect(conversation).toContain('context.comment');
	expect(conversation).not.toContain('{@html context.content}');
});
