import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('permission cards identify their Session and render only supplied options', () => {
	const conversation = read('./Conversation.svelte');
	expect(conversation).toMatch(/permissionDetails\(\s*item\.toolCall \?\? \{\}\s*\)/);
	expect(conversation).toContain('<dt>Session</dt>');
	expect(conversation).toContain('{#each item.options ?? [] as option}');
	expect(conversation).not.toMatch(/auto.allow|yolo/i);
});

test('the contextual inspector is opened from the session header rather than a fourth column', () => {
	const header = read('./SessionHeader.svelte');
	const inspector = read('./SessionInspector.svelte');
	expect(header).toContain('<SessionInspector');
	expect(inspector).toContain('<dialog');
	expect(inspector).toContain('<dt>{row.label}</dt>');
});
