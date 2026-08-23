const kinds = new Set(['completed', 'permission', 'clarify', 'failed', 'unknown']);

export type PushPayload = {
	id: string | null;
	kind: string;
	title: string;
	body: string;
	path: string;
};

const fallback: PushPayload = {
	id: null,
	kind: 'unknown',
	title: 'HUE notification',
	body: 'Open HUE to review.',
	path: '/'
};

export function parsePushPayload(value: unknown): PushPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
	const input = value as Record<string, unknown>;
	if (
		typeof input.id !== 'string' ||
		input.id.length > 200 ||
		typeof input.kind !== 'string' ||
		!kinds.has(input.kind) ||
		typeof input.title !== 'string' ||
		!input.title ||
		input.title.length > 80 ||
		typeof input.body !== 'string' ||
		!input.body ||
		input.body.length > 160 ||
		typeof input.path !== 'string' ||
		!input.path.startsWith('/') ||
		input.path.startsWith('//') ||
		input.path.length > 1000
	) {
		return { ...fallback };
	}
	return {
		id: input.id,
		kind: input.kind,
		title: input.title,
		body: input.body,
		path: input.path
	};
}

export function notificationDisplayOptions(
	payload: PushPayload
): NotificationOptions & { actions: Array<{ action: string; title: string }> } {
	return {
		body: payload.body,
		icon: '/icons/hue-192.png',
		badge: '/icons/hue-192.png',
		tag: payload.id ?? undefined,
		data: { id: payload.id, url: payload.path },
		actions: [{ action: 'open', title: 'Open HUE' }]
	};
}
