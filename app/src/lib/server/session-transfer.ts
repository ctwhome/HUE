import type { InputAttachment } from '$lib/message-content';

type ExportInput = {
	session: { sessionId: string; title: string | null; tags: string[]; folder: string | null };
	transcript: Array<{ role: 'user' | 'assistant'; text: string }>;
	attachments: InputAttachment[];
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
			)
		].join('\n\n');
		return { body, contentType: 'text/markdown; charset=utf-8', extension: 'md' };
	}
	return {
		body: JSON.stringify(
			{
				format: 'hue-session',
				version: 1,
				session: input.session,
				transcript: input.transcript,
				attachments: input.attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size }))
			},
			null,
			2
		),
		contentType: 'application/json; charset=utf-8',
		extension: 'json'
	};
}
