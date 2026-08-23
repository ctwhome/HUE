import {
	attachmentLimits,
	validateAttachmentBytes,
	type InputAttachment
} from '$lib/message-content';

export type ShareIntake = { text: string; attachments: InputAttachment[] };

const textLimit = 16_000;
const titleLimit = 500;
const urlLimit = 2_048;

function boundedField(form: FormData, name: string, limit: number, message: string) {
	const value = form.get(name);
	if (value == null) return '';
	if (typeof value !== 'string' || value.length > limit) throw new Error(message);
	return value.trim();
}

export async function parseShareForm(form: FormData): Promise<ShareIntake> {
	const title = boundedField(form, 'title', titleLimit, 'Shared title is too long');
	const text = boundedField(form, 'text', textLimit, 'Shared text is too long');
	const url = boundedField(form, 'url', urlLimit, 'Shared URL is too long');
	if (url) {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error('Shared URL is invalid');
		}
		if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Shared URL is invalid');
	}
	const values = form.getAll('files');
	if (values.length > attachmentLimits.maxCount)
		throw new Error(`Attach no more than ${attachmentLimits.maxCount} files`);
	if (values.some((value) => !(value instanceof File))) throw new Error('Invalid shared file');
	const attachments = validateAttachmentBytes(
		await Promise.all(
			(values as File[]).map(async (file) => ({
				name: file.name,
				mimeType: file.type.split(';', 1)[0].toLowerCase(),
				size: file.size,
				bytes: new Uint8Array(await file.arrayBuffer())
			}))
		)
	).map(({ bytes, ...attachment }) => ({
		...attachment,
		data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
	}));
	const combined = [title, text, url].filter(Boolean).join('\n\n');
	if (!combined && !attachments.length) throw new Error('No shared content received');
	return { text: combined, attachments };
}

type Entry = { expiresAt: number; intake: ShareIntake; decodedBytes: number };
type Schedule = (callback: () => void, delay: number) => void;

const defaultSchedule: Schedule = (callback, delay) => {
	const timer = setTimeout(callback, delay);
	timer.unref?.();
};

export class ShareIntakeStore {
	private entries = new Map<string, Entry>();
	private retainedBytes = 0;
	constructor(
		private ttl = 5 * 60_000,
		private now = Date.now,
		private token: () => string = () => crypto.randomUUID(),
		private schedule: Schedule = defaultSchedule,
		private retainedByteLimit = SHARE_INTAKE_RETAINED_BYTE_LIMIT
	) {}

	put(intake: ShareIntake) {
		this.cleanup();
		const token = this.token();
		if (this.entries.size >= 32 && !this.entries.has(token))
			throw new Error('Share intake is busy; try again');
		const expiresAt = this.now() + this.ttl;
		const decodedBytes = intake.attachments.reduce((sum, attachment) => sum + attachment.size, 0);
		const existingBytes = this.entries.get(token)?.decodedBytes ?? 0;
		const retainedBytes = this.retainedBytes - existingBytes + decodedBytes;
		if (
			!Number.isSafeInteger(decodedBytes) ||
			decodedBytes < 0 ||
			retainedBytes > this.retainedByteLimit
		)
			throw new Error('Share intake is busy; try again');
		const entry = { expiresAt, intake, decodedBytes };
		this.entries.set(token, entry);
		this.retainedBytes = retainedBytes;
		this.schedule(() => {
			if (this.entries.get(token) === entry && entry.expiresAt <= this.now()) this.delete(token);
		}, this.ttl);
		return token;
	}

	consume(token: string) {
		const entry = this.entries.get(token);
		this.delete(token);
		return entry && entry.expiresAt > this.now() ? entry.intake : null;
	}

	cleanup() {
		const now = this.now();
		for (const [token, entry] of this.entries) {
			if (entry.expiresAt <= now) this.delete(token);
		}
	}

	private delete(token: string) {
		const entry = this.entries.get(token);
		if (!entry) return;
		this.entries.delete(token);
		this.retainedBytes -= entry.decodedBytes;
	}
}

export const SHARE_INTAKE_RETAINED_BYTE_LIMIT = 80 * 1024 * 1024;
export const shareIntakes = new ShareIntakeStore();
