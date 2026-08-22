import { json } from '@sveltejs/kit';
import { statSync } from 'node:fs';
import { automaticSessionIcon } from '$lib/icon';
import { projectBranch, services, sessionMatchesProjectRoot } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
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
		const roots = new Set([project.rootPath, ...services().store.listSessionRoots(project.id)]);
		const availableRoots = new Set<string>();
		const sessions = [];
		for (const root of roots) {
			try {
				if (!statSync(root).isDirectory()) continue;
			} catch {
				continue;
			}
			availableRoots.add(root);
			sessions.push(
				...(await services().runtime.listSessions(root)).filter(
					(session) =>
						sessionMatchesProjectRoot(root, session.cwd) &&
						!services().store.isSessionDismissed(project.id, session.sessionId)
				)
			);
		}
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
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		const session = await services().runtime.createSession(project.rootPath);
		if (!sessionMatchesProjectRoot(project.rootPath, session.cwd)) {
			throw new Error(`Hermes Session ${session.sessionId} is outside the Project root`);
		}
		services().store.upsertSession(project.id, session);
		services().dispatcher.recover();
		return json(
			{
				session: { ...session, icon: automaticSessionIcon(session.title), customIcon: null },
				commands: services().runtime.getAvailableCommands(session.sessionId),
				runtime: services().runtime.getSessionState(session.sessionId),
				branch: projectBranch(project.rootPath)
			},
			{ status: 201 }
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};
