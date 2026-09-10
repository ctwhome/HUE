import { json } from '@sveltejs/kit';
import { statSync } from 'node:fs';
import { automaticSessionIcon } from '$lib/icon';
import { parseSessionHarness, sessionHarnessLabel } from '$lib/session-harness';
import { parseWorkMode } from '$lib/work-mode';
import {
	authoritativeProject,
	projectBranch,
	services,
	sessionMatchesProjectFolders
} from '$lib/server/route-services';
import type { RequestHandler } from './$types';

async function listRuntimeSessions(root: string) {
	const runtime = services().sessionRuntime;
	const [hermes, opencode] = await Promise.all([
		runtime.listSessions(root),
		runtime.listSessions(root, 'opencode').catch(() => [])
	]);
	return [...hermes, ...opencode];
}

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const query = url.searchParams.get('q')?.trim() ?? '';
		const includeArchived = url.searchParams.get('archived') === 'true';
		const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 100));
		const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
		if (url.searchParams.get('cached') === 'true' || offset > 0) {
			const projectId = services().store.hasProjectMetadata(params.projectId)
				? params.projectId
				: (await authoritativeProject(params.projectId)).id;
			const page = services().store.listSessionPage(projectId, {
				includeArchived,
				query,
				limit,
				offset
			});
			const ids = page.sessions.map(({ sessionId }) => sessionId);
			const busyStarts = services().store.getBusySessionStarts(projectId, ids);
			const indicators = services().store.getSessionIndicators(projectId, 'all', ids);
			return json({
				projectId,
				reconciliation: 'cached',
				sessions: page.sessions.map((stored) => {
					let available = false;
					try {
						available = statSync(stored.cwd).isDirectory();
					} catch {
						// Cached unavailable Sessions remain visible for recovery.
					}
					const title =
						stored.title ??
						`${available ? 'Untitled' : 'Unavailable'} ${sessionHarnessLabel(stored.harness)} Session`;
					return {
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
						error: indicators[stored.sessionId]?.error ?? false,
						status: indicators[stored.sessionId]?.status ?? null,
						unreadAttention: indicators[stored.sessionId]?.unreadAttention ?? false
					};
				}),
				hasMore: page.hasMore
			});
		}
		const project = await authoritativeProject(params.projectId);
		const folders = project.folders.map(({ path }) => path);
		const requestedSessionId = url.searchParams.get('sessionId');
		if (requestedSessionId) {
			const stored =
				requestedSessionId.length <= 500
					? services().store.getSession(project.id, requestedSessionId)
					: null;
			if (!stored) return json({ projectId: project.id, sessions: [], hasMore: false });
			let available = false;
			try {
				available = statSync(stored.cwd).isDirectory();
			} catch {
				// Persisted unavailable Sessions remain visible for recovery.
			}
			const busyStarts = services().store.getBusySessionStarts(project.id, [stored.sessionId]);
			const indicators = services().store.getSessionIndicators(project.id, 'all', [
				stored.sessionId
			]);
			const title =
				stored.title ??
				`${available ? 'Untitled' : 'Unavailable'} ${sessionHarnessLabel(stored.harness)} Session`;
			return json({
				projectId: project.id,
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
						error: indicators[stored.sessionId]?.error ?? false,
						status: indicators[stored.sessionId]?.status ?? null,
						unreadAttention: indicators[stored.sessionId]?.unreadAttention ?? false
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
			for (const session of await listRuntimeSessions(root)) {
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
		const runtimeById = new Map(sessions.map((session) => [session.sessionId, session]));
		const page = services().store.listSessionPage(project.id, {
			includeArchived,
			query,
			limit,
			offset
		});
		const ids = page.sessions.map(({ sessionId }) => sessionId);
		const busyStarts = services().store.getBusySessionStarts(project.id, ids);
		const indicators = services().store.getSessionIndicators(project.id, 'all', ids);
		return json({
			projectId: project.id,
			reconciliation: 'complete',
			sessions: page.sessions.map((stored) => {
				const runtime = runtimeById.get(stored.sessionId);
				const available = !!runtime || availableRoots.has(stored.cwd);
				const title =
					stored.title ??
					runtime?.title ??
					`${available ? 'Untitled' : 'Unavailable'} ${sessionHarnessLabel(stored.harness)} Session`;
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
					error: indicators[stored.sessionId]?.error ?? false,
					status: indicators[stored.sessionId]?.status ?? null,
					unreadAttention: indicators[stored.sessionId]?.unreadAttention ?? false
				};
			}),
			hasMore: page.hasMore
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const text = await request.text();
		const body = text ? (JSON.parse(text) as { workMode?: unknown; harness?: unknown }) : {};
		const workMode = body.workMode === undefined ? null : parseWorkMode(body.workMode);
		if (body.workMode !== undefined && !workMode)
			return json({ error: 'Invalid work mode' }, { status: 400 });
		const harness = body.harness === undefined ? 'hermes' : parseSessionHarness(body.harness);
		if (!harness) return json({ error: 'Invalid Session harness' }, { status: 400 });
		const project = await authoritativeProject(params.projectId);
		const folders = project.folders.map(({ path }) => path);
		const session = await services().sessionRuntime.createSession(project.primary_path, harness);
		if (!sessionMatchesProjectFolders(folders, session.cwd)) {
			throw new Error(`${sessionHarnessLabel(harness)} Session is outside the Project root`);
		}
		services().store.upsertSession(project.id, { ...session, workMode });
		const stored = services().store.getSession(project.id, session.sessionId)!;
		services().dispatcher.recover();
		return json(
			{
				session: {
					...session,
					...stored,
					icon: stored.icon ?? automaticSessionIcon(session.title),
					customIcon: stored.icon
				},
				commands: services().sessionRuntime.getAvailableCommands(session.sessionId),
				runtime: services().sessionRuntime.getSessionState(session.sessionId),
				branch: await projectBranch(project.primary_path)
			},
			{ status: 201 }
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
	}
};
