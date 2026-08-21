import { expect, test } from 'bun:test';
import { validateImageAttachments } from './message-content';

test('accepts supported base64 image attachments', () => {
	expect(
		validateImageAttachments([
			{ name: 'screen.png', mimeType: 'image/png', data: 'aGVsbG8=' }
		])
	).toEqual([{ name: 'screen.png', mimeType: 'image/png', data: 'aGVsbG8=' }]);
});

test('rejects non-image attachment content', () => {
	expect(() =>
		validateImageAttachments([{ name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }])
	).toThrow('Only PNG, JPEG, GIF, and WebP images are supported');
});
