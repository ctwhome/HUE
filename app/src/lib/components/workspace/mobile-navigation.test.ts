import { describe, expect, test } from 'bun:test';
import {
	beginMobileGesture,
	compactModelLabel,
	finishMobileGesture,
	parseNavigationMemory,
	resolveNavigationDestination,
	updateMobileGesture
} from './mobile-navigation';

const projects = ['project-1', 'project-2'];

describe('durable mobile navigation', () => {
	test('clean first launch uses first valid Project without opening a drawer', () => {
		expect(resolveNavigationDestination(new URL('http://hue.local/'), null, projects)).toEqual({
			projectId: 'project-1',
			sessionId: null,
			pane: null,
			explicit: false
		});
	});

	test('explicit route intent wins over remembered navigation', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: 'projects'
		});

		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?project=project-2&session=session-2'),
				remembered,
				projects
			)
		).toEqual({
			projectId: 'project-2',
			sessionId: 'session-2',
			pane: null,
			explicit: true
		});
	});

	test('ordinary launch restores durable destination and rejects transient fields', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: 'sessions',
			dialog: 'delete-session',
			loading: true
		});

		expect(parseNavigationMemory(remembered)).toEqual({
			version: 1,
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: 'sessions'
		});
		expect(
			resolveNavigationDestination(new URL('http://hue.local/'), remembered, projects)
		).toEqual({
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: 'sessions',
			explicit: false
		});
	});

	test('stale remembered project falls back to Projects without a stale session', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'deleted-project',
			sessionId: 'deleted-session',
			pane: 'sessions'
		});

		expect(
			resolveNavigationDestination(new URL('http://hue.local/'), remembered, projects)
		).toEqual({
			projectId: null,
			sessionId: null,
			pane: 'projects',
			explicit: false
		});
	});
});

describe('mobile gesture state', () => {
	test('uses safe edge band and rejects reserved edge, excluded targets, and dialogs', () => {
		expect(
			beginMobileGesture({
				pane: null,
				hasSession: true,
				startX: 32,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: false,
				excluded: false,
				dialogOpen: false
			})
		).not.toBeNull();
		for (const override of [
			{ startX: 8 },
			{ startX: 120 },
			{ excluded: true },
			{ dialogOpen: true }
		]) {
			expect(
				beginMobileGesture({
					pane: null,
					hasSession: true,
					startX: 32,
					startY: 240,
					viewportWidth: 390,
					startedOnDrawer: false,
					excluded: false,
					dialogOpen: false,
					...override
				})
			).toBeNull();
		}
	});

	test('locks intent and keeps vertical conversation scrolling native', () => {
		const gesture = beginMobileGesture({
			pane: null,
			hasSession: true,
			startX: 32,
			startY: 240,
			viewportWidth: 390,
			startedOnDrawer: false,
			excluded: false,
			dialogOpen: false
		})!;

		expect(updateMobileGesture(gesture, 38, 270)).toMatchObject({ status: 'cancelled' });
	});

	test('combines distance and velocity while short drags snap back', () => {
		const start = () =>
			beginMobileGesture({
				pane: null,
				hasSession: true,
				startX: 32,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: false,
				excluded: false,
				dialogOpen: false
			})!;

		expect(finishMobileGesture(updateMobileGesture(start(), 72, 242), 320, 0.1)).toMatchObject({
			commit: false,
			destination: null
		});
		expect(finishMobileGesture(updateMobileGesture(start(), 142, 242), 320, 0.1)).toMatchObject({
			commit: true,
			destination: 'sessions'
		});
		expect(finishMobileGesture(updateMobileGesture(start(), 72, 242), 320, 0.7)).toMatchObject({
			commit: true,
			destination: 'sessions'
		});
	});

	test('slow long drag keeps tracking after intent locks and commits by distance', () => {
		const start = beginMobileGesture({
			pane: null,
			hasSession: true,
			startX: 32,
			startY: 240,
			viewportWidth: 390,
			startedOnDrawer: false,
			excluded: false,
			dialogOpen: false
		})!;
		const active = updateMobileGesture(start, 48, 241);
		const dragged = updateMobileGesture(active, 142, 242);

		expect(dragged).toMatchObject({ status: 'active', deltaX: 110, deltaY: 2 });
		expect(finishMobileGesture(dragged, 320, 0.05)).toMatchObject({
			commit: true,
			destination: 'sessions'
		});
	});

	test('Session list swipes back to Projects and both drawers dismiss left', () => {
		const sessionGesture = beginMobileGesture({
			pane: 'sessions',
			hasSession: true,
			startX: 180,
			startY: 240,
			viewportWidth: 390,
			startedOnDrawer: true,
			excluded: false,
			dialogOpen: false
		})!;
		expect(
			finishMobileGesture(updateMobileGesture(sessionGesture, 300, 242), 320, 0.2)
		).toMatchObject({ commit: true, action: 'show-projects', destination: 'projects' });

		for (const pane of ['sessions', 'projects'] as const) {
			const gesture = beginMobileGesture({
				pane,
				hasSession: true,
				startX: 180,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: true,
				excluded: false,
				dialogOpen: false
			})!;
			expect(finishMobileGesture(updateMobileGesture(gesture, 70, 242), 320, -0.2)).toMatchObject({
				commit: true,
				action: `close-${pane}`,
				destination: null
			});
		}
	});
});

describe('compact model label', () => {
	test('removes provider and account noise while keeping model identity', () => {
		expect(compactModelLabel('openai:gpt-5.6-sol', 'OpenAI work subscription · GPT 5.6 Sol')).toBe(
			'gpt-5.6-sol'
		);
		expect(compactModelLabel('openrouter:openai/gpt-5.6-sol', 'OpenRouter account')).toBe(
			'gpt-5.6-sol'
		);
		expect(compactModelLabel('', 'Claude Sonnet 4.5')).toBe('Claude Sonnet 4.5');
	});
});
