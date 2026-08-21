import { json } from '@sveltejs/kit';
import { projectBranch, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasProjectSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const snapshot = services().store.getSessionSnapshot(params.projectId, params.sessionId);
	try {
		const transcript = await services().runtime.loadTranscript(project.rootPath, params.sessionId);
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

export const PATCH: RequestHandler = async ({ params, request }) => {
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
	if (!services().store.hasProjectSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	if (services().store.getSessionSnapshot(params.projectId, params.sessionId).activeTurn) {
		return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
	}
	try {
		const body = (await request.json()) as { modelId?: string; modeId?: string };
		const modelId = body.modelId?.trim();
		const modeId = body.modeId?.trim();
		if ((modelId ? 1 : 0) + (modeId ? 1 : 0) !== 1) {
			return json({ error: 'Provide exactly one modelId or modeId' }, { status: 400 });
		}
		const runtime = modelId
			? await services().runtime.setModel(params.sessionId, modelId)
			: await services().runtime.setMode(params.sessionId, modeId!);
		return json({ runtime });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
