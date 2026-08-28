import { describe, expect, test } from 'bun:test';
import {
	beginMobileGesture,
	compactModelLabel,
	finishMobileGesture,
	parseNavigationMemory,
	resolveInitialMobilePane,
	resolveLaunchDestination,
	resolveNavigationDestination,
	updateMobileGesture
} from './mobile-navigation';

const projects = ['project-1', 'project-2'];

describe('durable mobile navigation', () => {
	test('launch precedence is explicit, shortcut/share, notification, remembered, default', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'project-1',
			sessionId: 'remembered',
			pane: null
		});
		const notification = { projectId: 'project-2', sessionId: 'notified' };

		expect(
			resolveLaunchDestination(
				new URL('http://hue.local/?project=project-1&session=explicit&intent=capture'),
				remembered,
				projects,
				notification
			)
		).toMatchObject({ sessionId: 'explicit', intent: null, source: 'explicit' });
		expect(
			resolveLaunchDestination(
				new URL('http://hue.local/?intent=capture'),
				remembered,
				projects,
				notification
			)
		).toMatchObject({ sessionId: null, intent: 'capture', source: 'intent' });
		expect(
			resolveLaunchDestination(new URL('http://hue.local/'), null, projects, notification)
		).toMatchObject({ projectId: 'project-2', sessionId: 'notified', source: 'notification' });
		expect(
			resolveLaunchDestination(new URL('http://hue.local/'), remembered, projects)
		).toMatchObject({ sessionId: 'remembered', source: 'remembered' });
		expect(resolveLaunchDestination(new URL('http://hue.local/'), null, projects)).toMatchObject({
			projectId: 'project-1',
			source: 'default'
		});
	});

	test('share carries only one-time token and projectless new Session is explicit action', () => {
		expect(
			resolveLaunchDestination(
				new URL('http://hue.local/?intent=share&token=one-time'),
				null,
				projects
			)
		).toMatchObject({ intent: 'share', token: 'one-time', projectId: null });
		expect(
			resolveLaunchDestination(new URL('http://hue.local/?intent=new-session'), null, projects)
		).toMatchObject({ intent: 'new-session', projectId: null, sessionId: null });
	});

	test('native quick capture opens same non-submitting capture intent', () => {
		expect(
			resolveLaunchDestination(new URL('http://hue.local/?quick-capture=1'), null, projects)
		).toMatchObject({ intent: 'capture', projectId: null, sessionId: null, source: 'intent' });
	});
	test('clean first launch starts at Projects with the first valid Project ready', () => {
		expect(resolveNavigationDestination(new URL('http://hue.local/'), null, projects)).toEqual({
			projectId: 'project-1',
			sessionId: null,
			pane: 'projects',
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

	test('shortcut and share intents beat remembered destination but not explicit deep links', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: 'sessions'
		});

		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?intent=capture'),
				remembered,
				projects
			)
		).toMatchObject({ projectId: null, sessionId: null, pane: null, explicit: false });
		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?intent=share&token=one-time'),
				remembered,
				projects
			)
		).toMatchObject({ projectId: null, sessionId: null, pane: null, explicit: false });
		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?project=project-2&session=session-2&intent=capture'),
				remembered,
				projects
			)
		).toMatchObject({
			projectId: 'project-2',
			sessionId: 'session-2',
			pane: null,
			explicit: true
		});
	});

	test('Projects and Recents shortcut intents replace remembered session selection', () => {
		const remembered = JSON.stringify({
			version: 1,
			projectId: 'project-1',
			sessionId: 'session-1',
			pane: null
		});
		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?intent=projects'),
				remembered,
				projects
			)
		).toMatchObject({ projectId: null, sessionId: null, pane: 'projects' });
		expect(
			resolveNavigationDestination(
				new URL('http://hue.local/?intent=recents'),
				remembered,
				projects
			)
		).toMatchObject({ projectId: 'project-1', sessionId: null, pane: 'sessions' });
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

	test('ordinary mobile launches return to Projects without overriding explicit destinations', () => {
		expect(resolveInitialMobilePane({ pane: null, source: 'remembered' })).toBe('projects');
		expect(resolveInitialMobilePane({ pane: null, source: 'default' })).toBe('projects');
		expect(resolveInitialMobilePane({ pane: null, source: 'explicit' })).toBeNull();
		expect(resolveInitialMobilePane({ pane: null, source: 'notification' })).toBeNull();
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
	test('starts a back gesture anywhere on chat while rejecting excluded targets and dialogs', () => {
		expect(
			beginMobileGesture({
				pane: null,
				hasSession: true,
				startX: 180,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: false,
				excluded: false,
				dialogOpen: false
			})
		).not.toBeNull();
		for (const override of [
			{ excluded: true },
			{ dialogOpen: true },
			{ hasSession: false }
		]) {
			expect(
				beginMobileGesture({
					pane: null,
					hasSession: true,
					startX: 180,
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

	test('Session list swipes back to Projects but Projects never drags', () => {
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

		expect(
			beginMobileGesture({
				pane: 'projects',
				hasSession: true,
				startX: 180,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: true,
				excluded: false,
				dialogOpen: false
			})
		).toBeNull();
	});

	test('leftward drags do not navigate forward or dismiss a pane', () => {
		for (const pane of ['sessions', null] as const) {
			const gesture = beginMobileGesture({
				pane,
				hasSession: true,
				startX: 180,
				startY: 240,
				viewportWidth: 390,
				startedOnDrawer: pane === 'sessions',
				excluded: false,
				dialogOpen: false
			})!;
			expect(updateMobileGesture(gesture, 70, 242)).toMatchObject({ status: 'cancelled' });
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
