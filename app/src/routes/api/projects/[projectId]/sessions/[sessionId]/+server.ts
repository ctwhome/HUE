import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { projectBranch, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const session = services().store.getSession(params.projectId, params.sessionId)!;
	const snapshot = services().store.getSessionSnapshot(params.projectId, params.sessionId);
	try {
		const transcript = await services().runtime.loadTranscript(session.cwd, params.sessionId);
		return json({
			transcript,
			commands: services().runtime.getAvailableCommands(params.sessionId),
			runtime: services().runtime.getSessionState(params.sessionId),
			branch: projectBranch(project.rootPath),
			...snapshot
		});
	} catch (error) {
		if (snapshot.messages.length) {
			return json({
				transcript: [],
				transcriptError: error instanceof Error ? error.message : String(error),
				...snapshot
			});
		}
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const source = services().store.getSession(params.projectId, params.sessionId)!;
	if (services().store.getSessionSnapshot(params.projectId, params.sessionId).activeTurn) {
		return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
	}
	try {
		const session = await services().runtime.forkSession(source.cwd, params.sessionId);
		services().store.upsertSession(project.id, session);
		return json(
			{
				session,
				commands: services().runtime.getAvailableCommands(session.sessionId),
				runtime: services().runtime.getSessionState(session.sessionId)
			},
			{ status: 201 }
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as { modelId?: string; modeId?: string; icon?: unknown };
		const modelId = body.modelId?.trim();
		const modeId = body.modeId?.trim();
		const hasIcon = 'icon' in body;
		if ((modelId ? 1 : 0) + (modeId ? 1 : 0) + (hasIcon ? 1 : 0) !== 1) {
			return json({ error: 'Provide exactly one modelId, modeId, or icon' }, { status: 400 });
		}
		if (hasIcon) {
			const icon = validateIcon(body.icon);
			services().store.updateSessionIcon(params.projectId, params.sessionId, icon);
			return json({ icon });
		}
		if (services().store.getSessionSnapshot(params.projectId, params.sessionId).activeTurn) {
			return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
		}
		const runtime = modelId
			? await services().runtime.setModel(params.sessionId, modelId)
			: await services().runtime.setMode(params.sessionId, modeId!);
		return json({ runtime });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
