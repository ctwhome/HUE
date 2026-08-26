import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { applyMessageWorkMode } from '$lib/server/work-mode-context';
import { MessageConflictError } from '$lib/server/store';
import { validateMessageAttachments, validateReviewContexts } from '$lib/message-content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
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
		const reviewContexts = validateReviewContexts(body.reviewContexts);
		if (
			!messageId ||
			(!text.trim() && !images.length && !attachments.length && !reviewContexts.length)
		) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const workMode = applyMessageWorkMode(
			services().store,
			null,
			params.sessionId,
			text,
			Boolean(images.length || attachments.length || reviewContexts.length)
		);
		if (workMode.consumed) {
			return json(
				{
					messageId,
					duplicate: false,
					status: 'completed',
					workMode: workMode.workMode,
					workModeChanged: workMode.changed,
					workModeEvent: workMode.event,
					consumed: true
				},
				{ status: 202 }
			);
		}
		const accepted = services().dispatcher.submit({
			id: messageId,
			projectId: null,
			sessionId: params.sessionId,
			text,
			images,
			attachments,
			reviewContexts
		});
		return json(
			{
				messageId,
				...accepted,
				workMode: workMode.workMode,
				workModeChanged: workMode.changed,
				workModeEvent: workMode.event
			},
			{ status: 202 }
		);
	} catch (cause) {
		if (cause instanceof MessageConflictError) {
			return json({ error: cause.message }, { status: 409 });
		}
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!services().store.hasSession(null, params.sessionId)) {
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
		const reviewContexts =
			body.reviewContexts === undefined ? undefined : validateReviewContexts(body.reviewContexts);
		if (
			!messageId ||
			(!text.trim() && !images.length && !attachments.length && !reviewContexts?.length)
		) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const message = services().dispatcher.updateQueuedMessage(messageId, {
			projectId: null,
			sessionId: params.sessionId,
			text,
			images: preserveAttachments ? [] : images,
			attachments: preserveAttachments ? undefined : attachments,
			reviewContexts
		});
		return json({ message });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
	}
};
