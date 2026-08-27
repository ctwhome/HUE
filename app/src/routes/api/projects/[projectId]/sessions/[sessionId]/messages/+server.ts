import { json } from '@sveltejs/kit';
import { applyMessageWorkMode } from '$lib/server/work-mode-context';
import { services } from '$lib/server/route-services';
import { MessageConflictError } from '$lib/server/store';
import { validateMessageAttachments, validateReviewContexts } from '$lib/message-content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
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
		const accepted = await services().projectOperations.message(params.projectId, (project) => {
			services().store.ensureProjectMetadata(project.id);
			if (!services().store.hasSession(project.id, params.sessionId)) {
				throw new Error('Session not found');
			}
			const workMode = applyMessageWorkMode(
				services().store,
				project.id,
				params.sessionId,
				text,
				Boolean(images.length || attachments.length || reviewContexts.length)
			);
			if (workMode.consumed) {
				return {
					duplicate: false,
					status: 'completed',
					workMode: workMode.workMode,
					workModeChanged: workMode.changed,
					workModeEvent: workMode.event,
					consumed: true
				};
			}
			return {
				...services().dispatcher.submit({
					id: messageId,
					projectId: project.id,
					sessionId: params.sessionId,
					text,
					images,
					attachments,
					reviewContexts
				}),
				workModeChanged: workMode.changed,
				workModeEvent: workMode.event
			};
		});
		return json({ messageId, ...accepted }, { status: 202 });
	} catch (error) {
		if (error instanceof MessageConflictError) {
			return json({ error: error.message }, { status: 409 });
		}
		const message = error instanceof Error ? error.message : String(error);
		return json(
			{ error: message },
			{ status: message === 'Project not found' || message === 'Session not found' ? 404 : 400 }
		);
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
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
		const message = await services().projectOperations.message(params.projectId, (project) => {
			if (!services().store.hasSession(project.id, params.sessionId)) {
				throw new Error('Session not found');
			}
			return services().dispatcher.updateQueuedMessage(messageId, {
				projectId: project.id,
				sessionId: params.sessionId,
				text,
				images: preserveAttachments ? [] : images,
				attachments: preserveAttachments ? undefined : attachments,
				reviewContexts
			});
		});
		return json({ message });
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return json(
			{ error: message },
			{ status: message === 'Project not found' || message === 'Session not found' ? 404 : 409 }
		);
	}
};
