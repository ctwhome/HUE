import { expect, test } from 'bun:test';
import {
	chatBackgroundStyle,
	readChatBackground,
	resolveChatBackground,
	writeGeneralChatBackground,
	writeChatBackground
} from './chat-background';

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
}

test('stores a background for only the selected Session', () => {
	const storage = memoryStorage();
	writeChatBackground(storage, 'session-one', { kind: 'template', id: 'sunset' });

	expect(readChatBackground(storage, 'session-one')).toEqual({ kind: 'template', id: 'sunset' });
	expect(readChatBackground(storage, 'session-two')).toBeNull();
});

test('ignores invalid saved backgrounds and only styles supported image data', () => {
	const storage = memoryStorage();
	storage.setItem(
		'hue:chat-background:unsafe',
		JSON.stringify({ kind: 'custom', image: 'https://x' })
	);

	expect(readChatBackground(storage, 'unsafe')).toBeNull();
	expect(chatBackgroundStyle({ kind: 'custom', image: 'data:image/webp;base64,YQ==' })).toContain(
		'--chat-background-light: url("data:image/webp;base64,YQ==")'
	);
});

test('templates provide coordinated light and dark artwork', () => {
	const style = chatBackgroundStyle({ kind: 'template', id: 'sunset' });

	expect(style).toContain('--chat-background-light:');
	expect(style).toContain('--chat-background-dark:');
	expect(style.match(/--chat-background-(?:light|dark):/g)).toHaveLength(2);
});

test('clears a Session background', () => {
	const storage = memoryStorage();
	writeChatBackground(storage, 'session-one', { kind: 'template', id: 'ocean' });
	writeChatBackground(storage, 'session-one', null);

	expect(readChatBackground(storage, 'session-one')).toBeNull();
});

test('Sessions inherit the general background until they choose an override', () => {
	const storage = memoryStorage();
	writeGeneralChatBackground(storage, { kind: 'template', id: 'meadow' });

	expect(resolveChatBackground(storage, 'session-one')).toEqual({
		kind: 'template',
		id: 'meadow'
	});
	writeChatBackground(storage, 'session-one', { kind: 'template', id: 'ocean' });
	writeGeneralChatBackground(storage, { kind: 'template', id: 'sunset' });
	expect(resolveChatBackground(storage, 'session-one')).toEqual({ kind: 'template', id: 'ocean' });
	expect(resolveChatBackground(storage, 'session-two')).toEqual({ kind: 'template', id: 'sunset' });
});

test('a Session can explicitly opt out of the general background', () => {
	const storage = memoryStorage();
	writeGeneralChatBackground(storage, { kind: 'template', id: 'confetti' });
	writeChatBackground(storage, 'session-one', { kind: 'none' });

	expect(resolveChatBackground(storage, 'session-one')).toBeNull();
});
