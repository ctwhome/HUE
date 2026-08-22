import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const session = services().store.getSession(null, params.sessionId);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });
	const snapshot = services().store.getSessionSnapshot(null, params.sessionId);
	try {
		const transcript = await services().runtime.loadTranscript(session.cwd, params.sessionId);
		return json({
			transcript,
			commands: services().runtime.getAvailableCommands(params.sessionId),
			runtime: services().runtime.getSessionState(params.sessionId),
			branch: null,
			...snapshot
		});
	} catch (cause) {
		if (snapshot.messages.length) {
			return json({
				transcript: [],
				transcriptError: cause instanceof Error ? cause.message : String(cause),
				...snapshot
			});
		}
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params }) => {
	const current = services().store.getSession(null, params.sessionId);
	if (!current) return json({ error: 'Session not found' }, { status: 404 });
	if (services().store.getSessionSnapshot(null, params.sessionId).activeTurn) {
		return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
	}
	try {
		const session = await services().runtime.forkSession(current.cwd, params.sessionId);
		services().store.upsertSession(null, session);
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
	if (!services().store.hasSession(null, params.sessionId)) {
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
			services().store.updateSessionIcon(null, params.sessionId, icon);
			return json({ icon });
		}
		if (services().store.getSessionSnapshot(null, params.sessionId).activeTurn) {
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
