export const chatBackgroundTemplates = [
	{
		id: 'sunset',
		label: 'Sunset',
		light:
			'radial-gradient(circle at 18% 22%, rgb(251 146 60 / 38%), transparent 36%), radial-gradient(circle at 80% 12%, rgb(244 114 182 / 30%), transparent 34%), linear-gradient(145deg, #fff7ed, #ede9fe)',
		dark: 'radial-gradient(circle at 18% 22%, rgb(251 191 36 / 45%), transparent 34%), radial-gradient(circle at 80% 12%, rgb(244 114 182 / 38%), transparent 32%), linear-gradient(145deg, #4c1d3d, #172554)'
	},
	{
		id: 'ocean',
		label: 'Ocean',
		light:
			'radial-gradient(circle at 20% 18%, rgb(6 182 212 / 28%), transparent 38%), radial-gradient(circle at 78% 72%, rgb(59 130 246 / 24%), transparent 42%), linear-gradient(145deg, #ecfeff, #dbeafe)',
		dark: 'radial-gradient(circle at 20% 18%, rgb(34 211 238 / 32%), transparent 36%), radial-gradient(circle at 78% 72%, rgb(59 130 246 / 35%), transparent 40%), linear-gradient(145deg, #083344, #172554)'
	},
	{
		id: 'meadow',
		label: 'Meadow',
		light:
			'radial-gradient(circle at 20% 25%, rgb(132 204 22 / 26%), transparent 36%), radial-gradient(circle at 82% 18%, rgb(20 184 166 / 22%), transparent 38%), linear-gradient(145deg, #f7fee7, #ccfbf1)',
		dark: 'radial-gradient(circle at 20% 25%, rgb(190 242 100 / 32%), transparent 34%), radial-gradient(circle at 82% 18%, rgb(45 212 191 / 30%), transparent 36%), linear-gradient(145deg, #14532d, #134e4a)'
	},
	{
		id: 'confetti',
		label: 'Confetti',
		light:
			'radial-gradient(circle at 20% 20%, #ec4899 0 5px, transparent 6px), radial-gradient(circle at 75% 28%, #eab308 0 6px, transparent 7px), radial-gradient(circle at 42% 75%, #0891b2 0 5px, transparent 6px), linear-gradient(145deg, #fdf4ff, #fef3c7)',
		dark: 'radial-gradient(circle at 20% 20%, #f472b6 0 5px, transparent 6px), radial-gradient(circle at 75% 28%, #facc15 0 6px, transparent 7px), radial-gradient(circle at 42% 75%, #22d3ee 0 5px, transparent 6px), linear-gradient(145deg, #312e81, #581c87)'
	}
] as const;

export type ChatBackground =
	| { kind: 'template'; id: (typeof chatBackgroundTemplates)[number]['id'] }
	| { kind: 'custom'; image: string }
	| { kind: 'none' };

type BackgroundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (sessionId: string) => `hue:chat-background:${sessionId}`;
const generalKey = 'hue:chat-background:default';
const supportedImage = /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/;

export function readChatBackground(
	storage: Pick<Storage, 'getItem'>,
	sessionId: string
): ChatBackground | null {
	try {
		const value = JSON.parse(storage.getItem(key(sessionId)) ?? 'null') as Partial<ChatBackground>;
		if (value?.kind === 'template' && chatBackgroundTemplates.some(({ id }) => id === value.id))
			return value as ChatBackground;
		if (
			value?.kind === 'custom' &&
			typeof value.image === 'string' &&
			supportedImage.test(value.image)
		)
			return { kind: 'custom', image: value.image };
		if (value?.kind === 'none') return { kind: 'none' };
	} catch {
		// Ignore malformed browser-local preferences.
	}
	return null;
}

export function readGeneralChatBackground(
	storage: Pick<Storage, 'getItem'>
): Exclude<ChatBackground, { kind: 'none' }> | null {
	const background = readChatBackground({ getItem: () => storage.getItem(generalKey) }, 'default');
	return background?.kind === 'none' ? null : background;
}

export function writeGeneralChatBackground(
	storage: BackgroundStorage,
	background: Exclude<ChatBackground, { kind: 'none' }> | null
) {
	if (background) storage.setItem(generalKey, JSON.stringify(background));
	else storage.removeItem(generalKey);
}

export function resolveChatBackground(
	storage: Pick<Storage, 'getItem'>,
	sessionId: string
): Exclude<ChatBackground, { kind: 'none' }> | null {
	const session = readChatBackground(storage, sessionId);
	if (session?.kind === 'none') return null;
	return session ?? readGeneralChatBackground(storage);
}

export function writeChatBackground(
	storage: BackgroundStorage,
	sessionId: string,
	background: ChatBackground | null
) {
	if (background) storage.setItem(key(sessionId), JSON.stringify(background));
	else storage.removeItem(key(sessionId));
}

export function chatBackgroundStyle(background: ChatBackground | null) {
	if (!background) return '';
	if (background.kind === 'none') return '';
	const template =
		background.kind === 'template'
			? chatBackgroundTemplates.find(({ id }) => id === background.id)
			: null;
	const light = background.kind === 'custom' ? `url("${background.image}")` : template?.light;
	const dark = background.kind === 'custom' ? light : template?.dark;
	return light && dark ? `--chat-background-light: ${light}; --chat-background-dark: ${dark};` : '';
}

export async function resizeChatBackground(file: File): Promise<string> {
	if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
		throw new Error('Choose a PNG, JPEG, or WebP image');
	if (file.size > 10 * 1024 * 1024) throw new Error('Background image must be 10 MB or smaller');
	const source = await createImageBitmap(file);
	try {
		const scale = Math.min(1, 1920 / Math.max(source.width, source.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(source.width * scale);
		canvas.height = Math.round(source.height * scale);
		canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/webp', 0.82)
		);
		if (!blob) throw new Error('Could not prepare that background image');
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	} finally {
		source.close();
	}
}

export const CHAT_BACKGROUND_EVENT = 'hue:chat-background';
