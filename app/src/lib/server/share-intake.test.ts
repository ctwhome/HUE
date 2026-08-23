import { expect, test } from 'bun:test';
import { SHARE_INTAKE_RETAINED_BYTE_LIMIT, ShareIntakeStore, parseShareForm } from './share-intake';

const textFile = (name = 'idea.txt', contents = 'private idea') =>
	new File([contents], name, { type: 'text/plain' });

test('share intake bounds text and validates file name, MIME, size, and signature', async () => {
	const valid = new FormData();
	valid.set('title', 'Research');
	valid.set('text', 'Read this');
	valid.set('url', 'https://example.test/private');
	valid.append('files', textFile());
	const parsed = await parseShareForm(valid);
	expect(parsed.text).toBe('Research\n\nRead this\n\nhttps://example.test/private');
	expect(parsed.attachments[0]).toMatchObject({
		name: 'idea.txt',
		mimeType: 'text/plain',
		size: 12
	});

	const oversized = new FormData();
	oversized.set('text', 'x'.repeat(16_001));
	await expect(parseShareForm(oversized)).rejects.toThrow('Shared text is too long');

	const mismatched = new FormData();
	mismatched.append('files', new File(['not png'], 'idea.png', { type: 'image/png' }));
	await expect(parseShareForm(mismatched)).rejects.toThrow(
		'Attachment content does not match its declared type'
	);
});

test('share intake expires deterministically and consumes once', () => {
	let now = 1_000;
	const store = new ShareIntakeStore(
		5_000,
		() => now,
		() => 'token-1'
	);
	const intake = { text: 'private', attachments: [] };
	expect(store.put(intake)).toBe('token-1');
	expect(store.consume('token-1')).toEqual(intake);
	expect(store.consume('token-1')).toBeNull();
	store.put(intake);
	now = 6_001;
	expect(store.consume('token-1')).toBeNull();
});

const intakeWithBytes = (size: number) => ({
	text: '',
	attachments: [{ name: 'idea.txt', mimeType: 'text/plain', size, data: 'eA==' }]
});

test('share intake enforces explicit retained decoded-byte budget under concurrent puts', async () => {
	let sequence = 0;
	const store = new ShareIntakeStore(5_000, Date.now, () => `token-${++sequence}`, undefined, 10);
	const results = await Promise.allSettled([
		Promise.resolve().then(() => store.put(intakeWithBytes(6))),
		Promise.resolve().then(() => store.put(intakeWithBytes(6)))
	]);
	expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
	expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
	expect(SHARE_INTAKE_RETAINED_BYTE_LIMIT).toBeGreaterThanOrEqual(64 * 1024 * 1024);
	expect(SHARE_INTAKE_RETAINED_BYTE_LIMIT).toBeLessThanOrEqual(96 * 1024 * 1024);
});

test('share intake releases retained bytes on consume, expiry, and token replacement', () => {
	let now = 1_000;
	const scheduled: Array<() => void> = [];
	let token = 'same-token';
	const store = new ShareIntakeStore(
		5_000,
		() => now,
		() => token,
		(callback) => scheduled.push(callback),
		10
	);
	store.put(intakeWithBytes(8));
	store.put(intakeWithBytes(10));
	expect(() => store.put(intakeWithBytes(11))).toThrow('Share intake is busy; try again');
	expect(store.consume(token)).not.toBeNull();
	token = 'after-consume';
	expect(store.put(intakeWithBytes(10))).toBe(token);
	now = 6_001;
	scheduled.at(-1)!();
	token = 'after-expiry';
	expect(store.put(intakeWithBytes(10))).toBe(token);
});

test('share intake replacement releases old entry even at count capacity', () => {
	let sequence = 0;
	const store = new ShareIntakeStore(5_000, Date.now, () =>
		sequence++ < 32 ? `token-${sequence}` : 'token-1'
	);
	for (let index = 0; index < 32; index += 1) store.put({ text: `${index}`, attachments: [] });
	expect(store.put({ text: 'replacement', attachments: [] })).toBe('token-1');
	expect(store.consume('token-1')?.text).toBe('replacement');
});
