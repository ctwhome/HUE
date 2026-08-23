import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { authoritativeProject, projectBranch, services } from '$lib/server/route-services';
import { exportSession } from '$lib/server/session-transfer';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	const session = services().store.getSession(project.id, params.sessionId)!;
	const snapshot = services().store.getSessionSnapshot(project.id, params.sessionId);
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
			commands: services().runtime.getAvailableCommands(params.sessionId),
			runtime: services().runtime.getSessionState(params.sessionId),
			branch: projectBranch(project.primary_path),
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

export const POST: RequestHandler = async ({ params, request }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request?.json?.().catch(() => ({}))) as { title?: unknown } | undefined;
		return await services().dispatcher.withSessionLock(params.sessionId, async () => {
			const source = services().store.getSession(project.id, params.sessionId);
			if (!source) return json({ error: 'Session not found' }, { status: 404 });
			if (services().store.getSessionSnapshot(project.id, params.sessionId).activeTurn) {
				return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
			}
			let metadata;
			try {
				metadata = services().store.prepareSessionCopy(
					project.id,
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
				services().store.upsertSession(project.id, session);
				const stored = services().store.copySessionMetadata(
					project.id,
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
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	if (!services().store.hasSession(project.id, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			modelId?: string;
			modeId?: string;
			icon?: unknown;
			title?: unknown;
			pinned?: unknown;
			archived?: unknown;
			folder?: unknown;
			tags?: unknown;
		};
		const modelId = body.modelId?.trim();
		const modeId = body.modeId?.trim();
		const hasIcon = 'icon' in body;
		const metadataKeys = ['title', 'pinned', 'archived', 'folder', 'tags'].filter(
			(key) => key in body
		);
		if ((modelId ? 1 : 0) + (modeId ? 1 : 0) + (hasIcon || metadataKeys.length ? 1 : 0) !== 1) {
			return json(
				{ error: 'Provide one runtime, icon, or Session metadata update' },
				{ status: 400 }
			);
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
				project.id,
				params.sessionId,
				Object.fromEntries([
					...metadataKeys.map((key) => [key, body[key as keyof typeof body]]),
					...(hasIcon ? [['icon', icon]] : [])
				])
			);
			return json({ session, icon: session.icon });
		}
		if (hasIcon) {
			const icon = validateIcon(body.icon);
			services().store.updateSession(project.id, params.sessionId, { icon });
			return json({ icon });
		}
		if (services().store.getSessionSnapshot(project.id, params.sessionId).activeTurn) {
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

export const DELETE: RequestHandler = async ({ params, url }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	const impact = services().store.previewSessionDelete(project.id, params.sessionId);
	if (!impact) return json({ error: 'Session not found' }, { status: 404 });
	if (url.searchParams.get('confirm') !== 'true')
		return json({ impact: { ...impact, hermesTranscriptRetained: true } });
	try {
		services().store.deleteSession(project.id, params.sessionId);
		return json({ deleted: true, hermesTranscriptRetained: true });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
	}
};
