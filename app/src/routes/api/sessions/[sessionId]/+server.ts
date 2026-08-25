import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { applyExplicitWorkMode } from '$lib/server/work-mode-context';
import { services } from '$lib/server/services';
import { exportSession } from '$lib/server/session-transfer';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const session = services().store.getSession(null, params.sessionId);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });
	const snapshot = services().store.getSessionSnapshot(null, params.sessionId);
	try {
		const transcript = await services().runtime.loadTranscript(session.cwd, params.sessionId);
		const format = url.searchParams.get('format');
		if (format === 'json' || format === 'markdown') {
			const exported = exportSession(format, {
				session: {
					sessionId: session.sessionId,
					title: session.title,
					tags: session.tags,
					folder: session.folder
				},
				transcript,
				attachments: snapshot.messages.flatMap(({ attachments, images }) => [
					...attachments,
					...images.map((image) => ({
						...image,
						size: Buffer.from(image.data, 'base64').byteLength
					}))
				])
			});
			return new Response(exported.body, {
				headers: {
					'content-type': exported.contentType,
					'content-disposition': `attachment; filename="hue-${params.sessionId}.${exported.extension}"`,
					'x-content-type-options': 'nosniff'
				}
			});
		}
		return json({
			transcript,
			workMode: session.workMode,
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
				workMode: session.workMode,
				...snapshot
			});
		}
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!services().store.getSession(null, params.sessionId))
		return json({ error: 'Session not found' }, { status: 404 });
	try {
		const body = (await request?.json?.().catch(() => ({}))) as { title?: unknown } | undefined;
		return await services().dispatcher.withSessionLock(params.sessionId, async () => {
			const source = services().store.getSession(null, params.sessionId);
			if (!source) return json({ error: 'Session not found' }, { status: 404 });
			if (services().store.getSessionSnapshot(null, params.sessionId).activeTurn) {
				return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
			}
			let metadata;
			try {
				metadata = services().store.prepareSessionCopy(
					null,
					params.sessionId,
					body && 'title' in body ? body.title : undefined
				);
			} catch (cause) {
				return json(
					{ error: cause instanceof Error ? cause.message : String(cause) },
					{ status: 400 }
				);
			}
			const session = await services().runtime.forkSession(source.cwd, params.sessionId);
			try {
				services().store.upsertSession(null, session);
				const stored = services().store.copySessionMetadata(
					null,
					params.sessionId,
					session.sessionId,
					metadata
				);
				return json(
					{
						session: { ...session, ...stored },
						commands: services().runtime.getAvailableCommands(session.sessionId),
						runtime: services().runtime.getSessionState(session.sessionId)
					},
					{ status: 201 }
				);
			} catch (cause) {
				return json(
					{
						session,
						reconciliationRequired: true,
						error: cause instanceof Error ? cause.message : String(cause)
					},
					{ status: 202 }
				);
			}
		});
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			modelId?: string;
			modeId?: string;
			configId?: string;
			configValue?: unknown;
			workMode?: unknown;
			icon?: unknown;
			title?: unknown;
			pinned?: unknown;
			archived?: unknown;
			folder?: unknown;
			tags?: unknown;
		};
		const modelId = body.modelId?.trim();
		const modeId = body.modeId?.trim();
		const configId = body.configId?.trim();
		const hasConfig = 'configId' in body || 'configValue' in body;
		const hasWorkMode = 'workMode' in body;
		const hasIcon = 'icon' in body;
		const metadataKeys = ['title', 'pinned', 'archived', 'folder', 'tags'].filter(
			(key) => key in body
		);
		if (
			(modelId ? 1 : 0) +
				(modeId ? 1 : 0) +
				(hasConfig ? 1 : 0) +
				(hasWorkMode ? 1 : 0) +
				(hasIcon || metadataKeys.length ? 1 : 0) !==
			1
		) {
			return json(
				{ error: 'Provide one runtime, icon, or Session metadata update' },
				{ status: 400 }
			);
		}
		if (
			hasConfig &&
			(!configId || !('configValue' in body) || !['string', 'boolean'].includes(typeof body.configValue))
		)
			return json({ error: 'Invalid Session configuration update' }, { status: 400 });
		if (hasWorkMode) {
			const { session, event } = applyExplicitWorkMode(
				services().store,
				null,
				params.sessionId,
				body.workMode,
				'selector'
			);
			return json({ session, workMode: session.workMode, ...(event ? { event } : {}) });
		}
		if (metadataKeys.length) {
			if (
				('pinned' in body && typeof body.pinned !== 'boolean') ||
				('archived' in body && typeof body.archived !== 'boolean') ||
				('tags' in body && !Array.isArray(body.tags)) ||
				('title' in body && body.title !== null && typeof body.title !== 'string') ||
				('folder' in body && body.folder !== null && typeof body.folder !== 'string')
			)
				return json({ error: 'Invalid Session metadata' }, { status: 400 });
			const icon = hasIcon ? validateIcon(body.icon) : undefined;
			const session = services().store.updateSession(
				null,
				params.sessionId,
				Object.fromEntries([
					...metadataKeys.map((key) => [key, body[key as keyof typeof body]]),
					...(hasIcon ? [['icon', icon]] : [])
				])
			);
			return json({ session, icon: session.icon, workMode: session.workMode });
		}
		if (hasIcon) {
			const icon = validateIcon(body.icon);
			const session = services().store.updateSession(null, params.sessionId, { icon });
			return json({ icon, workMode: session.workMode });
		}
		if (services().store.getSessionSnapshot(null, params.sessionId).activeTurn) {
			return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
		}
		const runtime = modelId
			? await services().runtime.setModel(params.sessionId, modelId)
			: modeId
				? await services().runtime.setMode(params.sessionId, modeId)
				: await services().runtime.setConfigOption(
						params.sessionId,
						configId!,
						body.configValue as string | boolean
					);
		return json({ runtime });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = ({ params, url }) => {
	const impact = services().store.previewSessionDelete(null, params.sessionId);
	if (!impact) return json({ error: 'Session not found' }, { status: 404 });
	if (url.searchParams.get('confirm') !== 'true')
		return json({ impact: { ...impact, hermesTranscriptRetained: true } });
	try {
		services().store.deleteSession(null, params.sessionId);
		return json({ deleted: true, hermesTranscriptRetained: true });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
	}
};
