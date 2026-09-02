import { json, type RequestEvent } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { validateMessageAttachments, validateReviewContexts } from '$lib/message-content';
import { authoritativeProject, projectBranch, services } from '$lib/server/route-services';
import type { BrowserInteractionResponse } from '$lib/server/message-dispatcher';
import { localSameOriginMutationAllowed, sameOriginMutationAllowed } from '$lib/server/same-origin';
import {
	closeSessionMedia,
	resolveSessionMedia,
	serveSessionMedia
} from '$lib/server/session-media';
import { exportSession } from '$lib/server/session-transfer';
import { MessageConflictError } from '$lib/server/store';
import { applyExplicitWorkMode, submitMessageWithWorkMode } from '$lib/server/work-mode-context';
import {
	generatePromptImprovement,
	type PromptImprovementAnswer
} from '$lib/server/prompt-improvement';

type SessionEvent = Pick<RequestEvent, 'request' | 'url' | 'getClientAddress'> & {
	params: { sessionId: string };
};

export async function resolveSessionScope(projectId: string | null, sessionId: string) {
	const project = projectId === null ? null : await authoritativeProject(projectId);
	const resolvedProjectId = project?.id ?? null;
	if (!services().store.hasSession(resolvedProjectId, sessionId))
		throw new Error('Session not found');
	return { projectId: resolvedProjectId, project };
}

async function scopeOrNotFound(projectId: string | null, sessionId: string) {
	try {
		return await resolveSessionScope(projectId, sessionId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
}

export async function improvePrompt(projectId: string | null, event: SessionEvent) {
	if (!sameOriginMutationAllowed(event.request, event.url)) {
		return json({ error: 'Prompt improvement requires a same-origin request' }, { status: 403 });
	}
	const scope = await scopeOrNotFound(projectId, event.params.sessionId);
	if (scope instanceof Response) return scope;
	try {
		const body = (await event.request.json()) as {
			text?: unknown;
			answers?: unknown;
			modelId?: unknown;
			operationId?: unknown;
		};
		if (
			typeof body.text !== 'string' ||
			!Array.isArray(body.answers) ||
			(body.modelId !== undefined && typeof body.modelId !== 'string') ||
			typeof body.operationId !== 'string'
		)
			throw new Error('Invalid prompt improvement request');
		return json(
			await generatePromptImprovement(
				{
					projectId: scope.projectId,
					sourceSessionId: event.params.sessionId,
					text: body.text,
					answers: body.answers as PromptImprovementAnswer[],
					modelId: body.modelId,
					operationId: body.operationId
				},
				services()
			)
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
}

export async function getSession(projectId: string | null, { params, url }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
	const session = services().store.getSession(scope.projectId, params.sessionId)!;
	const snapshot = services().store.getSessionSnapshot(scope.projectId, params.sessionId);
	try {
		const transcript = await services().admin.loadTranscript(params.sessionId);
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
				]),
				reviewContexts: snapshot.messages.flatMap(({ id, reviewContexts }) =>
					reviewContexts?.length ? [{ messageId: id, contexts: reviewContexts }] : []
				)
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
			branch: scope.project ? projectBranch(scope.project.primary_path) : null,
			...snapshot
		});
	} catch (cause) {
		if (snapshot.messages.length) {
			return json({
				transcript: [],
				transcriptError: cause instanceof Error ? cause.message : String(cause),
				workMode: session.workMode,
				commands: services().runtime.getAvailableCommands(params.sessionId),
				runtime: services().runtime.getSessionState(params.sessionId),
				branch: scope.project ? projectBranch(scope.project.primary_path) : null,
				...snapshot
			});
		}
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
}

export async function copySession(projectId: string | null, { params, request }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
	try {
		const body = (await request?.json?.().catch(() => ({}))) as { title?: unknown } | undefined;
		return await services().dispatcher.withSessionLock(params.sessionId, async () => {
			const source = services().store.getSession(scope.projectId, params.sessionId);
			if (!source) return json({ error: 'Session not found' }, { status: 404 });
			if (services().store.getSessionSnapshot(scope.projectId, params.sessionId).activeTurn) {
				return json({ error: 'Wait for the active turn to finish' }, { status: 409 });
			}
			let metadata;
			try {
				metadata = services().store.prepareSessionCopy(
					scope.projectId,
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
				services().store.upsertSession(scope.projectId, session);
				const stored = services().store.copySessionMetadata(
					scope.projectId,
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
		const message = cause instanceof Error ? cause.message : String(cause);
		return json(
			{ error: message },
			{ status: message === 'Hermes does not support Session duplication' ? 409 : 503 }
		);
	}
}

export async function patchSession(projectId: string | null, { params, request }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
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
			read?: unknown;
		};
		const modelId = body.modelId?.trim();
		const modeId = body.modeId?.trim();
		const configId = body.configId?.trim();
		const hasConfig = 'configId' in body || 'configValue' in body;
		const hasWorkMode = 'workMode' in body;
		const hasIcon = 'icon' in body;
		const hasRead = 'read' in body;
		const metadataKeys = ['title', 'pinned', 'archived', 'folder', 'tags'].filter(
			(key) => key in body
		);
		if (
			(modelId ? 1 : 0) +
				(modeId ? 1 : 0) +
				(hasConfig ? 1 : 0) +
				(hasWorkMode ? 1 : 0) +
				(hasRead ? 1 : 0) +
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
			(!configId ||
				!('configValue' in body) ||
				!['string', 'boolean'].includes(typeof body.configValue))
		)
			return json({ error: 'Invalid Session configuration update' }, { status: 400 });
		if (hasWorkMode) {
			const { session, event } = applyExplicitWorkMode(
				services().store,
				scope.projectId,
				params.sessionId,
				body.workMode,
				'selector'
			);
			return json({ session, workMode: session.workMode, ...(event ? { event } : {}) });
		}
		if (hasRead) {
			if (body.read !== true) return json({ error: 'Invalid Session read state' }, { status: 400 });
			return json({
				updated: services().store.markSessionNotificationsRead(scope.projectId, params.sessionId)
			});
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
				scope.projectId,
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
			const session = services().store.updateSession(scope.projectId, params.sessionId, { icon });
			return json({ icon, workMode: session.workMode });
		}
		if (services().store.getSessionSnapshot(scope.projectId, params.sessionId).activeTurn) {
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
}

export async function deleteSession(projectId: string | null, { params, url }: SessionEvent) {
	let scope;
	try {
		scope =
			projectId === null
				? { projectId: null }
				: await resolveSessionScope(projectId, params.sessionId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	const impact = services().store.previewSessionDelete(scope.projectId, params.sessionId);
	if (!impact) return json({ error: 'Session not found' }, { status: 404 });
	if (url.searchParams.get('confirm') !== 'true')
		return json({ impact: { ...impact, hermesTranscriptRetained: true } });
	try {
		services().store.deleteSession(scope.projectId, params.sessionId);
		return json({ deleted: true, hermesTranscriptRetained: true });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
	}
}

async function withMessageScope<T>(
	projectId: string | null,
	sessionId: string,
	operation: (resolvedProjectId: string | null) => T
) {
	if (projectId === null) return operation(null);
	return services().projectOperations.message(projectId, (project) => {
		services().store.ensureProjectMetadata(project.id, project.name);
		if (!services().store.hasSession(project.id, sessionId)) throw new Error('Session not found');
		return operation(project.id);
	});
}

export async function postMessage(projectId: string | null, { params, request }: SessionEvent) {
	if (projectId === null && !services().store.hasSession(null, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			messageId?: string;
			text?: string;
			images?: unknown;
			attachments?: unknown;
			reviewContexts?: unknown;
		};
		const messageId = body.messageId?.trim();
		const text = body.text ?? '';
		const { images, attachments } = validateMessageAttachments(body.images, body.attachments);
		if (images.length) {
			await services().runtime.start();
			if (!services().runtime.getCapabilities(params.sessionId).promptImage) {
				return json({ error: 'Hermes does not support image prompts' }, { status: 400 });
			}
		}
		const reviewContexts = validateReviewContexts(body.reviewContexts);
		if (
			!messageId ||
			(!text.trim() && !images.length && !attachments.length && !reviewContexts.length)
		) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const accepted = await withMessageScope(projectId, params.sessionId, (resolvedProjectId) =>
			submitMessageWithWorkMode(
				services().store,
				services().dispatcher,
				{
					id: messageId,
					projectId: resolvedProjectId,
					sessionId: params.sessionId,
					text,
					images,
					attachments,
					reviewContexts
				},
				Boolean(images.length || attachments.length || reviewContexts.length)
			)
		);
		return json({ messageId, ...accepted }, { status: 202 });
	} catch (cause) {
		if (cause instanceof MessageConflictError) {
			return json({ error: cause.message }, { status: 409 });
		}
		const message = cause instanceof Error ? cause.message : String(cause);
		return json(
			{ error: message },
			{ status: message === 'Project not found' || message === 'Session not found' ? 404 : 400 }
		);
	}
}

export async function patchMessage(projectId: string | null, { params, request }: SessionEvent) {
	if (projectId === null && !services().store.hasSession(null, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			messageId?: string;
			text?: string;
			images?: unknown;
			attachments?: unknown;
			reviewContexts?: unknown;
			preserveAttachments?: boolean;
		};
		const messageId = body.messageId?.trim();
		const text = body.text ?? '';
		const preserveAttachments = body.preserveAttachments === true;
		const { images, attachments } = validateMessageAttachments(
			body.images,
			preserveAttachments ? [] : body.attachments
		);
		if (images.length) {
			await services().runtime.start();
			if (!services().runtime.getCapabilities(params.sessionId).promptImage) {
				return json({ error: 'Hermes does not support image prompts' }, { status: 400 });
			}
		}
		const reviewContexts =
			body.reviewContexts === undefined ? undefined : validateReviewContexts(body.reviewContexts);
		if (
			!messageId ||
			(!text.trim() && !images.length && !attachments.length && !reviewContexts?.length)
		) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const message = await withMessageScope(projectId, params.sessionId, (resolvedProjectId) =>
			services().dispatcher.updateQueuedMessage(messageId, {
				projectId: resolvedProjectId,
				sessionId: params.sessionId,
				text,
				images: preserveAttachments ? [] : images,
				attachments: preserveAttachments ? undefined : attachments,
				reviewContexts
			})
		);
		return json({ message });
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return json(
			{ error: message },
			{ status: message === 'Project not found' || message === 'Session not found' ? 404 : 409 }
		);
	}
}

export async function getMedia(projectId: string | null, event: SessionEvent, head = false) {
	const scope = await scopeOrNotFound(projectId, event.params.sessionId);
	if (scope instanceof Response) return scope;
	const session = services().store.getSession(scope.projectId, event.params.sessionId)!;
	try {
		const media = resolveSessionMedia(session.cwd, event.url.searchParams.get('path') ?? '');
		return serveSessionMedia(
			media,
			event.request,
			event.url.searchParams.get('download') === 'true',
			head
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
}

export async function postMedia(projectId: string | null, event: SessionEvent) {
	if (!sameOriginMutationAllowed(event.request, event.url)) {
		return json({ error: 'Opening files is limited to this device' }, { status: 403 });
	}
	const scope = await scopeOrNotFound(projectId, event.params.sessionId);
	if (scope instanceof Response) return scope;
	const session = services().store.getSession(scope.projectId, event.params.sessionId)!;
	try {
		const body = (await event.request.json()) as { path?: string; action?: string };
		if (body.action !== 'open' && body.action !== 'reveal')
			return json({ error: 'Action must be open or reveal' }, { status: 400 });
		if (
			body.action === 'open' &&
			!localSameOriginMutationAllowed(event.request, event.url, event.getClientAddress())
		)
			return json({ error: 'Opening files is limited to this device' }, { status: 403 });
		const media = resolveSessionMedia(session.cwd, body.path ?? '');
		try {
			if (
				body.action === 'open' &&
				(media.mimeType === 'image/svg+xml' || media.mimeType === 'text/html')
			) {
				throw new Error(
					`${media.mimeType === 'image/svg+xml' ? 'SVG' : 'HTML'} outputs can only be previewed or revealed`
				);
			}
			const process = Bun.spawn(
				body.action === 'reveal' ? ['open', '-R', media.path] : ['open', media.path],
				{ stdout: 'ignore', stderr: 'pipe' }
			);
			if (await process.exited)
				throw new Error(
					(await new Response(process.stderr).text()) || `open exited ${process.exitCode}`
				);
			return json({ opened: true, action: body.action, provenance: media.provenance });
		} finally {
			closeSessionMedia(media);
		}
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
}

export async function getEvents(projectId: string | null, { params, url }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
	const rawAfter = Number(url.searchParams.get('after') ?? '0');
	const after = Number.isSafeInteger(rawAfter) && rawAfter >= 0 ? rawAfter : 0;
	return json({
		events: services().store.listEvents(scope.projectId, params.sessionId, after),
		runtime: services().runtime.getSessionState(params.sessionId)
	});
}

export async function postInteraction(projectId: string | null, { params, request }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
	let body: { interactionId?: unknown; response?: BrowserInteractionResponse };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'Invalid interaction response' }, { status: 400 });
	}
	if (!body || typeof body.interactionId !== 'string' || !body.response) {
		return json({ error: 'Invalid interaction response' }, { status: 400 });
	}
	const resolved = services().dispatcher.resolveInteraction(
		scope.projectId,
		params.sessionId,
		body.interactionId,
		body.response
	);
	return resolved
		? json({ resolved: true })
		: json({ error: 'Interaction is unavailable or response is invalid' }, { status: 409 });
}

export async function postCancel(projectId: string | null, { params }: SessionEvent) {
	const scope = await scopeOrNotFound(projectId, params.sessionId);
	if (scope instanceof Response) return scope;
	try {
		await services().runtime.cancelSession(params.sessionId);
		return json({ cancelled: true }, { status: 202 });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
}
