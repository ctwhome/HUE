import { validateReviewContexts, type ReviewContext } from '$lib/message-content';
import type { PendingEnvelope, Project, Session } from './types';
import type { FingerprintedAttachment } from './attachment-files';

const unsaved = new Map<string, string | null>();

export class MessagePersistence {
	constructor(
		private getProject: () => Project | null,
		private getSession: () => Session | null,
		private report: (message: string) => void = () => {}
	) {}
	private storage(key: string, value?: string | null): string | null {
		try {
			if (value === undefined)
				return unsaved.has(key) ? unsaved.get(key)! : localStorage.getItem(key);
			value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
			unsaved.delete(key);
		} catch {
			if (value !== undefined) unsaved.set(key, value);
			this.report(
				'Browser storage unavailable. Keep this tab open to retain unsaved drafts and exact retry.'
			);
		}
		return value ?? null;
	}
	private key(kind: 'draft' | 'pending' | 'contexts') {
		const session = this.getSession();
		return session && !session.pending
			? `hue:${kind}:${this.getProject()?.id ?? 'none'}:${session.sessionId}`
			: '';
	}
	contexts(value?: ReviewContext[]): ReviewContext[] {
		const key = this.key('contexts');
		if (!key) return [];
		if (value !== undefined) {
			this.storage(key, value.length ? JSON.stringify(value) : null);
			return value;
		}
		try {
			return validateReviewContexts(JSON.parse(this.storage(key) ?? '[]'));
		} catch {
			this.storage(key, null);
			return [];
		}
	}
	draft(value?: string) {
		const key = this.key('draft');
		if (!key) return '';
		if (value === undefined) return this.storage(key) ?? '';
		this.storage(key, value || null);
		return value;
	}
	pending(value?: PendingEnvelope | null): PendingEnvelope | null {
		const key = this.key('pending');
		if (!key) return null;
		if (value !== undefined) {
			value
				? this.storage(
						key,
						JSON.stringify({
							...value,
							reviewContexts: value.reviewContexts ?? [],
							attachments: value.attachments.map(
								({ name, mimeType, size, fingerprint }: FingerprintedAttachment) => ({
									name,
									mimeType,
									size,
									...(fingerprint ? { fingerprint } : {}),
									available: false,
									reattachRequired: true
								})
							)
						})
					)
				: this.storage(key, null);
			return value;
		}
		try {
			const saved = JSON.parse(this.storage(key) ?? 'null') as PendingEnvelope | null;
			return saved
				? {
						...saved,
						images: saved.images ?? [],
						reviewContexts: validateReviewContexts(saved.reviewContexts),
						attachments: (saved.attachments ?? []).map(
							({ name, mimeType, size, fingerprint }: FingerprintedAttachment) => ({
								name,
								mimeType,
								size,
								...(fingerprint ? { fingerprint } : {}),
								available: false,
								reattachRequired: true
							})
						)
					}
				: null;
		} catch {
			this.storage(key, null);
			return null;
		}
	}
}
