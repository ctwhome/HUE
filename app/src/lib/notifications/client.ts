export type NotificationCapability =
	'insecure' | 'unavailable' | 'push-unavailable' | 'denied' | 'ready' | 'permission-required';

export function notificationCapability(input: {
	secure: boolean;
	notification: boolean;
	push: boolean;
	permission: NotificationPermission;
}): NotificationCapability {
	if (!input.secure) return 'insecure';
	if (!input.notification) return 'unavailable';
	if (!input.push) return 'push-unavailable';
	if (input.permission === 'denied') return 'denied';
	return input.permission === 'granted' ? 'ready' : 'permission-required';
}

export async function requestSystemPermission(
	userGesture: boolean,
	api: Pick<typeof Notification, 'permission' | 'requestPermission'>
): Promise<NotificationPermission> {
	return userGesture ? api.requestPermission() : api.permission;
}

export function shouldPresentForeground(
	notification: { projectId: string | null; sessionId: string; kind: string },
	context: { projectId: string | null; sessionId: string | null; visible: boolean }
): boolean {
	if (notification.kind === 'permission' || notification.kind === 'clarify') return true;
	return !(
		context.visible &&
		notification.projectId === context.projectId &&
		notification.sessionId === context.sessionId
	);
}

export function shouldPlaySound(
	preference: { enabled: boolean; unlocked: boolean },
	presented: boolean
): boolean {
	return preference.enabled && preference.unlocked && presented;
}

export async function acknowledgeThenNavigate(
	markActed: () => Promise<unknown>,
	focus: () => void,
	navigate: () => void
): Promise<void> {
	await markActed().catch(() => undefined);
	focus();
	navigate();
}

export function attentionState(input: {
	loading: boolean;
	error: string;
	items: unknown[];
	unread: number;
}): { view: 'loading' | 'error' | 'empty' | 'list'; badge: string | null } {
	return {
		view: input.loading ? 'loading' : input.error ? 'error' : input.items.length ? 'list' : 'empty',
		badge: input.unread > 99 ? '99+' : input.unread > 0 ? String(input.unread) : null
	};
}

export function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
