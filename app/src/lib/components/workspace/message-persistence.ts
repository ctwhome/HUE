import { validateReviewContexts, type ReviewContext } from '$lib/message-content';
import type { PendingEnvelope, Project, Session } from './types';

export class MessagePersistence {
	constructor(
		private getProject: () => Project | null,
		private getSession: () => Session | null
	) {}
	private key(kind: 'draft' | 'pending' | 'contexts') {
		const session = this.getSession();
		return session ? `hue:${kind}:${this.getProject()?.id ?? 'none'}:${session.sessionId}` : '';
	}
	contexts(value?: ReviewContext[]): ReviewContext[] {
		const key = this.key('contexts');
		if (!key) return [];
		if (value !== undefined) {
			value.length
				? localStorage.setItem(key, JSON.stringify(value))
				: localStorage.removeItem(key);
			return value;
		}
		try {
			return validateReviewContexts(JSON.parse(localStorage.getItem(key) ?? '[]'));
		} catch {
			localStorage.removeItem(key);
			return [];
		}
	}
	draft(value?: string) {
		const key = this.key('draft');
		if (!key) return '';
		if (value === undefined) return localStorage.getItem(key) ?? '';
		value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
		return value;
	}
	pending(value?: PendingEnvelope | null): PendingEnvelope | null {
		const key = this.key('pending');
		if (!key) return null;
		if (value !== undefined) {
			value
				? localStorage.setItem(
						key,
						JSON.stringify({
							...value,
							reviewContexts: value.reviewContexts ?? [],
							attachments: value.attachments.map(({ name, mimeType, size }) => ({
								name,
								mimeType,
								size,
								available: false,
								reattachRequired: true
							}))
						})
					)
				: localStorage.removeItem(key);
			return value;
		}
		try {
			const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as PendingEnvelope | null;
			return saved
				? {
						...saved,
						images: saved.images ?? [],
						reviewContexts: validateReviewContexts(saved.reviewContexts),
						attachments: (saved.attachments ?? []).map(({ name, mimeType, size }) => ({
							name,
							mimeType,
							size,
							available: false,
							reattachRequired: true
						}))
					}
				: null;
		} catch {
			localStorage.removeItem(key);
			return null;
		}
	}
}
