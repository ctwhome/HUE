import { expect, test } from 'bun:test';
import {
	attachmentLimits,
	detectMediaOutputs,
	validateAttachments,
	validateImageAttachments,
	validateMessageAttachments
} from './message-content';

const encoded = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64');
const png = encoded(Buffer.from('89504e470d0a1a0a', 'hex'));

test('accepts supported base64 image attachments', () => {
	expect(
		validateImageAttachments([{ name: 'screen.png', mimeType: 'image/png', data: png }])
	).toEqual([{ name: 'screen.png', mimeType: 'image/png', data: png }]);
});

test('rejects non-image attachment content', () => {
	expect(() =>
		validateImageAttachments([{ name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }])
	).toThrow('Only PNG, JPEG, GIF, and WebP images are supported');
});

test('accepts files whose declarations match stable signatures or safe UTF-8 text', () => {
	expect(
		validateAttachments([
			{ name: 'guide.pdf', mimeType: 'application/pdf', size: 8, data: encoded('%PDF-1.7') },
			{
				name: 'memo.mp3',
				mimeType: 'audio/mpeg',
				size: 4,
				data: encoded(Buffer.from('49443304', 'hex'))
			},
			{
				name: 'clip.mp4',
				mimeType: 'video/mp4',
				size: 12,
				data: encoded(Buffer.from('000000186674797069736f6d', 'hex'))
			},
			{
				name: 'source.zip',
				mimeType: 'application/zip',
				size: 4,
				data: encoded(Buffer.from('504b0304', 'hex'))
			},
			{ name: 'notes.md', mimeType: 'text/markdown', size: 5, data: encoded('hello') },
			{ name: 'main.ts', mimeType: 'text/typescript', size: 5, data: encoded('hello') }
		])
	).toHaveLength(6);
});

test('rejects signature mismatch, invalid UTF-8, NUL text, and script MIME', () => {
	for (const candidate of [
		{ name: 'guide.pdf', mimeType: 'application/pdf', size: 5, data: encoded('hello') },
		{
			name: 'notes.txt',
			mimeType: 'text/plain',
			size: 2,
			data: encoded(new Uint8Array([0xc3, 0x28]))
		},
		{
			name: 'notes.txt',
			mimeType: 'text/plain',
			size: 3,
			data: encoded(new Uint8Array([0x61, 0, 0x62]))
		},
		{ name: 'run.js', mimeType: 'text/javascript', size: 5, data: encoded('hello') }
	])
		expect(() => validateAttachments([candidate])).toThrow();
});

test('enforces one count and aggregate budget across images and files', () => {
	const images = Array.from({ length: 4 }, (_, index) => ({
		name: `${index}.png`,
		mimeType: 'image/png',
		data: png
	}));
	const attachments = Array.from({ length: 5 }, (_, index) => ({
		name: `${index}.txt`,
		mimeType: 'text/plain',
		size: 5,
		data: encoded('hello')
	}));
	expect(() => validateMessageAttachments(images, attachments)).toThrow(
		`Attach no more than ${attachmentLimits.maxCount} files`
	);
	const half = Math.floor(attachmentLimits.maxTotalBytes / 2) + 1;
	const largeVideo = Buffer.concat([
		Buffer.from('000000186674797069736f6d', 'hex'),
		Buffer.alloc(half - 12)
	]).toString('base64');
	expect(() =>
		validateMessageAttachments(
			[],
			[
				{ name: 'one.mp4', mimeType: 'video/mp4', size: half, data: largeVideo },
				{ name: 'two.mp4', mimeType: 'video/mp4', size: half, data: largeVideo }
			]
		)
	).toThrow('Attachments must total 40 MB or smaller');
});

test('rejects unsafe names and mismatched or executable types', () => {
	const data = 'aGVsbG8=';
	for (const candidate of [
		{ name: '../notes.txt', mimeType: 'text/plain', size: 5, data },
		{ name: 'notes.txt', mimeType: 'application/pdf', size: 5, data },
		{ name: 'run.exe', mimeType: 'application/octet-stream', size: 5, data }
	]) {
		expect(() => validateAttachments([candidate])).toThrow();
	}
});

test('enforces declared, decoded, per-file, count, and aggregate attachment limits', () => {
	expect(Math.ceil((attachmentLimits.maxTotalBytes * 4) / 3)).toBeLessThan(60_000_000);
	const data = 'aGVsbG8=';
	expect(() =>
		validateAttachments([{ name: 'notes.txt', mimeType: 'text/plain', size: 4, data }])
	).toThrow('does not match');
	expect(() =>
		validateAttachments(
			Array.from({ length: attachmentLimits.maxCount + 1 }, (_, index) => ({
				name: `notes-${index}.txt`,
				mimeType: 'text/plain',
				size: 5,
				data
			}))
		)
	).toThrow(`no more than ${attachmentLimits.maxCount}`);
	const oversized = Buffer.concat([
		Buffer.from('%PDF-'),
		Buffer.alloc(attachmentLimits.maxDocumentBytes - 4)
	]).toString('base64');
	expect(() =>
		validateAttachments([
			{
				name: 'large.pdf',
				mimeType: 'application/pdf',
				size: attachmentLimits.maxDocumentBytes + 1,
				data: oversized
			}
		])
	).toThrow('25 MB or smaller');
});

test('detects only existing MEDIA outputs inside trusted root with provenance', () => {
	const root = '/workspace/project';
	const exists = (path: string) => path === '/workspace/project/output/report.pdf';
	expect(
		detectMediaOutputs(
			'MEDIA: output/report.pdf\nMEDIA: /private/secret.txt\nMEDIA: missing.mp3',
			root,
			exists
		)
	).toEqual([
		{
			name: 'report.pdf',
			mimeType: 'application/pdf',
			path: '/workspace/project/output/report.pdf',
			provenance: 'Hermes MEDIA output'
		}
	]);
});
