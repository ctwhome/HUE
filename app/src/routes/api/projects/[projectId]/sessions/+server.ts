import { json } from '@sveltejs/kit';
import { statSync } from 'node:fs';
import { automaticSessionIcon } from '$lib/icon';
import {
	authoritativeProject,
	projectBranch,
	services,
	sessionMatchesProjectFolders
} from '$lib/server/route-services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const folders = project.folders.map(({ path }) => path);
		const requestedSessionId = url.searchParams.get('sessionId');
		if (requestedSessionId) {
			const stored =
				requestedSessionId.length <= 500
					? services().store.getSession(project.id, requestedSessionId)
					: null;
			if (!stored) return json({ sessions: [], hasMore: false });
			let available = false;
			try {
				available = statSync(stored.cwd).isDirectory();
			} catch {
				// Persisted unavailable Sessions remain visible for recovery.
			}
			const busyStarts = services().store.getBusySessionStarts(project.id);
			const indicators = services().store.getSessionIndicators(project.id);
			const title =
				stored.title ?? (available ? 'Untitled Hermes Session' : 'Unavailable Hermes Session');
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
		const roots = new Set([...folders, ...services().store.listSessionRoots(project.id)]);
		const availableRoots = new Set<string>();
		const sessionsById = new Map();
		for (const root of roots) {
			try {
				if (!statSync(root).isDirectory()) continue;
			} catch {
				continue;
			}
			availableRoots.add(root);
			for (const session of await services().runtime.listSessions(root)) {
				if (
					(sessionMatchesProjectFolders(folders, session.cwd) ||
						services().store.hasSession(project.id, session.sessionId)) &&
					!services().store.isSessionDismissed(project.id, session.sessionId)
				) {
					sessionsById.set(session.sessionId, session);
				}
			}
		}
		const sessions = [...sessionsById.values()];
		for (const session of sessions) {
			services().store.upsertSession(project.id, session);
		}
		services().dispatcher.recover();
		const busyStarts = services().store.getBusySessionStarts(project.id);
		const indicators = services().store.getSessionIndicators(project.id);
		const runtimeById = new Map(sessions.map((session) => [session.sessionId, session]));
		const query = url.searchParams.get('q')?.trim() ?? '';
		const includeArchived = url.searchParams.get('archived') === 'true';
		const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 100));
		const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
		const page = services().store.listSessionPage(project.id, {
			includeArchived,
			query,
			limit,
			offset
		});
		return json({
			sessions: page.sessions.map((stored) => {
				const runtime = runtimeById.get(stored.sessionId);
				const available = !!runtime || availableRoots.has(stored.cwd);
				const title =
					stored.title ??
					runtime?.title ??
					(available ? 'Untitled Hermes Session' : 'Unavailable Hermes Session');
				return {
					...runtime,
					...stored,
					title,
					icon: stored.icon ?? automaticSessionIcon(title),
					customIcon: stored.icon,
					available,
					recovery: available ? null : `Restore the Session folder at ${stored.cwd} to resume it.`,
					busySince: busyStarts[stored.sessionId] ?? null,
					attention: indicators[stored.sessionId]?.attention ?? false,
					error: indicators[stored.sessionId]?.error ?? false
				};
			}),
			hasMore: page.hasMore
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ params }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const folders = project.folders.map(({ path }) => path);
		const session = await services().runtime.createSession(project.primary_path);
		if (!sessionMatchesProjectFolders(folders, session.cwd)) {
			throw new Error(`Hermes Session ${session.sessionId} is outside the Project root`);
		}
		services().store.upsertSession(project.id, session);
		services().dispatcher.recover();
		return json(
			{
				session: { ...session, icon: automaticSessionIcon(session.title), customIcon: null },
				commands: services().runtime.getAvailableCommands(session.sessionId),
				runtime: services().runtime.getSessionState(session.sessionId),
				branch: projectBranch(project.primary_path)
			},
			{ status: 201 }
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};
