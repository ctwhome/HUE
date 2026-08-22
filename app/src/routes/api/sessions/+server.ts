import { json } from '@sveltejs/kit';
import { automaticSessionIcon } from '$lib/icon';
import { services, sessionMatchesProjectRoot, unprojectedSessionRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const root = unprojectedSessionRoot();
	try {
		const sessions = (await services().runtime.listSessions(root)).filter((session) =>
			sessionMatchesProjectRoot(root, session.cwd)
		);
		for (const session of sessions) services().store.upsertSession(null, session);
		services().dispatcher.recover();
		const busyStarts = services().store.getBusySessionStarts(null);
		const indicators = services().store.getSessionIndicators(null);
		return json({
			sessions: sessions.map((session) => {
				const customIcon = services().store.getSession(null, session.sessionId)?.icon ?? null;
				return {
					...session,
					icon: customIcon ?? automaticSessionIcon(session.title),
					customIcon,
					busySince: busyStarts[session.sessionId] ?? null,
					attention: indicators[session.sessionId]?.attention ?? false,
					error: indicators[session.sessionId]?.error ?? false
				};
			})
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
		services().dispatcher.recover();
		return json(
			{
				session: { ...session, icon: automaticSessionIcon(session.title), customIcon: null },
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
