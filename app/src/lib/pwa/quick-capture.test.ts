import { expect, test } from 'bun:test';
import { captureDraftStorage, splitCaptureAttachments } from './quick-capture';

test('quick capture restores local text and project choice without persisting file bytes', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
	const draft = captureDraftStorage(storage);
	draft.write({ text: 'Unsent idea', projectId: 'project-1' });
	expect(draft.read()).toEqual({ text: 'Unsent idea', projectId: 'project-1' });
	expect([...values.values()].join(' ')).not.toContain('data');
	draft.clear();
	expect(draft.read()).toEqual({ text: '', projectId: null });
});

test('quick capture splits validated images from file attachments for composer population', () => {
	const attachments = [
		{ name: 'idea.png', mimeType: 'image/png', size: 8, data: 'iVBORw0KGgo=' },
		{ name: 'idea.txt', mimeType: 'text/plain', size: 4, data: 'aWRlYQ==' }
	];
	expect(splitCaptureAttachments(attachments)).toEqual({
		images: [{ name: 'idea.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
		attachments: [attachments[1]]
	});
});
