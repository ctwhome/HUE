import { json } from '@sveltejs/kit';
import { statSync } from 'node:fs';
import { automaticSessionIcon } from '$lib/icon';
import {
	mergeProjectSessionViews,
	projectBranch,
	services,
	sessionMatchesProjectRoot
} from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	try {
		const stored = services().store.listStoredSessions(project.id);
		const roots = new Set([project.rootPath, ...stored.map(({ cwd }) => cwd)]);
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
				...(await services().runtime.listSessions(root)).filter((session) =>
					sessionMatchesProjectRoot(root, session.cwd)
				)
			);
		}
		for (const session of sessions) {
			services().store.upsertSession(project.id, session);
		}
		services().dispatcher.recover();
		const busyStarts = services().store.getBusySessionStarts(project.id);
		const indicators = services().store.getSessionIndicators(project.id);
		return json({
			sessions: mergeProjectSessionViews(
				sessions,
				services().store.listStoredSessions(project.id),
				availableRoots
			).map((session) => {
				const customIcon = session.customIcon;
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
