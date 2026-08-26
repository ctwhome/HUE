import type { InputAttachment, ReviewContext } from '$lib/message-content';

type ExportInput = {
	session: { sessionId: string; title: string | null; tags: string[]; folder: string | null };
	transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
	attachments: InputAttachment[];
	reviewContexts: Array<{ messageId: string; contexts: ReviewContext[] }>;
};

export function exportSession(format: 'json' | 'markdown', input: ExportInput) {
	const title = input.session.title ?? 'Untitled Session';
	if (format === 'markdown') {
		const body = [
			`# ${title}`,
			...(input.session.folder ? [`Folder: ${input.session.folder}`] : []),
			...(input.session.tags.length ? [`Tags: ${input.session.tags.join(', ')}`] : []),
			...input.transcript.map(
				(message) => `## ${message.role === 'user' ? 'You' : 'Hermes'}\n\n${message.text}`
			),
			...input.reviewContexts.flatMap(({ messageId, contexts }) => [
				`## Review context for ${messageId}`,
				...contexts.map(
					(context) =>
						`### Captured source: ${context.label}\n\n${context.content
							.split('\n')
							.map((line) => `> ${line}`)
							.join('\n')}\n\nComment: ${context.comment || '(none)'}`
				)
			])
		].join('\n\n');
		return { body, contentType: 'text/markdown; charset=utf-8', extension: 'md' };
	}
	return {
		body: JSON.stringify(
			{
				format: 'hue-session',
				version: 2,
				session: input.session,
				transcript: input.transcript,
				attachments: input.attachments.map(({ name, mimeType, size }) => ({
					name,
					mimeType,
					size
				})),
				reviewContexts: input.reviewContexts
			},
			null,
			2
		),
		contentType: 'application/json; charset=utf-8',
		extension: 'json'
	};
}
