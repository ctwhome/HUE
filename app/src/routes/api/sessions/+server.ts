import { json } from '@sveltejs/kit';
import { automaticSessionIcon } from '$lib/icon';
import { services, sessionMatchesProjectRoot, unprojectedSessionRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const root = unprojectedSessionRoot();
	try {
		const requestedSessionId = url.searchParams.get('sessionId');
		if (requestedSessionId) {
			const stored =
				requestedSessionId.length <= 500
					? services().store.getSession(null, requestedSessionId)
					: null;
			if (!stored) return json({ sessions: [], hasMore: false });
			const busyStarts = services().store.getBusySessionStarts(null);
			const indicators = services().store.getSessionIndicators(null);
			const title = stored.title ?? 'Untitled Hermes Session';
			const available = sessionMatchesProjectRoot(root, stored.cwd);
			return json({
				sessions: [
					{
						...stored,
						title,
						icon: stored.icon ?? automaticSessionIcon(title),
						customIcon: stored.icon,
						available,
						recovery: available
							? null
							: `Restore the Session folder at ${stored.cwd} to resume it.`,
						busySince: busyStarts[stored.sessionId] ?? null,
						attention: indicators[stored.sessionId]?.attention ?? false,
						error: indicators[stored.sessionId]?.error ?? false
					}
				],
				hasMore: false
			});
		}
		const sessions = (await services().runtime.listSessions(root)).filter(
			(session) =>
				sessionMatchesProjectRoot(root, session.cwd) &&
				!services().store.isSessionDismissed(null, session.sessionId)
		);
		for (const session of sessions) services().store.upsertSession(null, session);
		services().dispatcher.recover();
		const busyStarts = services().store.getBusySessionStarts(null);
		const indicators = services().store.getSessionIndicators(null);
		const runtimeById = new Map(sessions.map((session) => [session.sessionId, session]));
		const query = url.searchParams.get('q')?.trim() ?? '';
		const includeArchived = url.searchParams.get('archived') === 'true';
		const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 100));
		const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
		const page = services().store.listSessionPage(null, { includeArchived, query, limit, offset });
		return json({
			sessions: page.sessions.map((stored) => {
				const runtime = runtimeById.get(stored.sessionId);
				const title = stored.title ?? runtime?.title ?? 'Untitled Hermes Session';
				return {
					...runtime,
					...stored,
					title,
					icon: stored.icon ?? automaticSessionIcon(title),
					customIcon: stored.icon,
					available: !!runtime,
					recovery: runtime ? null : `Restore the Session folder at ${stored.cwd} to resume it.`,
					busySince: busyStarts[stored.sessionId] ?? null,
					attention: indicators[stored.sessionId]?.attention ?? false,
					error: indicators[stored.sessionId]?.error ?? false
				};
			}),
			hasMore: page.hasMore
		});
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};

export const POST: RequestHandler = async () => {
	const root = unprojectedSessionRoot();
	try {
		const session = await services().runtime.createSession(root);
		if (!sessionMatchesProjectRoot(root, session.cwd)) {
			throw new Error('Hermes Session is outside the HUE session directory');
		}
		services().store.upsertSession(null, session);
		const stored = services().store.getSession(null, session.sessionId)!;
		services().dispatcher.recover();
		return json(
			{
				session: {
					...session,
					...stored,
					icon: stored.icon ?? automaticSessionIcon(session.title),
					customIcon: stored.icon
				},
				commands: services().runtime.getAvailableCommands(session.sessionId),
				runtime: services().runtime.getSessionState(session.sessionId),
				branch: null
			},
			{ status: 201 }
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
