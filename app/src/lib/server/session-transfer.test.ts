import { expect, test } from 'bun:test';
import { exportSession } from './session-transfer';

test('exports Markdown and JSON without attachment payloads or workspace paths', () => {
	const input = {
		session: {
			sessionId: 'session-1',
			title: 'Release notes',
			tags: ['release'],
			folder: 'Delivery'
		},
		transcript: [
			{ role: 'user' as const, text: 'Review this' },
			{ role: 'assistant' as const, text: 'Done' }
		],
		attachments: [{ name: 'notes.md', mimeType: 'text/markdown', size: 5, data: 'aGVsbG8=' }],
		reviewContexts: [
			{
				messageId: 'message-1',
				contexts: [
					{
						id: 'review-1',
						source: 'assistant' as const,
						label: 'Hermes response',
						content: 'Captured source',
						comment: 'Keep this separate.'
					}
				]
			}
		]
	};
	const json = exportSession('json', input);
	const markdown = exportSession('markdown', input);

	expect(JSON.parse(json.body)).toEqual({
		format: 'hue-session',
		version: 2,
		session: {
			sessionId: 'session-1',
			title: 'Release notes',
			tags: ['release'],
			folder: 'Delivery'
		},
		transcript: input.transcript,
		attachments: [{ name: 'notes.md', mimeType: 'text/markdown', size: 5 }],
		reviewContexts: input.reviewContexts
	});
	expect(json.body).not.toContain('aGVsbG8=');
	expect(markdown.body).toContain('# Release notes');
	expect(markdown.body).toContain('## You\n\nReview this');
	expect(markdown.body).toContain('## Hermes\n\nDone');
	expect(markdown.body).toContain('### Captured source: Hermes response');
	expect(markdown.body).toContain('Comment: Keep this separate.');
});
