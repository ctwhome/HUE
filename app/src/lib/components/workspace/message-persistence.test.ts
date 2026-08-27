import { beforeEach, expect, test } from 'bun:test';
import { MessagePersistence } from './message-persistence';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	}
});

beforeEach(() => values.clear());

test('pending persistence strips generic bytes and restores explicit reattach state', () => {
	const persistence = new MessagePersistence(
		() => ({
			id: 'project',
			name: 'HUE',
			icon: null,
			color: null,
			group: null,
			primaryPath: '/work',
			folders: [{ path: '/work', label: null, isPrimary: true, available: true }],
			rootAvailable: true
		}),
		() => ({ sessionId: 'session', cwd: '/work', icon: 'H', customIcon: null })
	);
	persistence.pending({
		id: 'message',
		projectId: 'project',
		sessionId: 'session',
		text: 'Review',
		images: [],
		attachments: [
			{ name: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'aGVsbG8=', available: true }
		]
	});
	expect([...values.values()].join('')).not.toContain('aGVsbG8=');
	expect(persistence.pending()?.attachments).toEqual([
		{
			name: 'notes.txt',
			mimeType: 'text/plain',
			size: 5,
			available: false,
			reattachRequired: true
		}
	]);
});

test('drafts remain scoped to their project and Session identity', () => {
	let projectId = 'project-a';
	let sessionId = 'session-1';
	const persistence = new MessagePersistence(
		() => ({ id: projectId }) as never,
		() => ({ sessionId }) as never
	);

	persistence.draft('Project A, Session 1');
	sessionId = 'session-2';
	persistence.draft('Project A, Session 2');
	projectId = 'project-b';
	expect(persistence.draft()).toBe('');
	persistence.draft('Project B, Session 2');

	projectId = 'project-a';
	expect(persistence.draft()).toBe('Project A, Session 2');
	sessionId = 'session-1';
	expect(persistence.draft()).toBe('Project A, Session 1');
});
