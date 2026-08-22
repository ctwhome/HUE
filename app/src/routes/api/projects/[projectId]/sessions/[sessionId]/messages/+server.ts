import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { MessageConflictError } from '$lib/server/store';
import { validateMessageAttachments } from '$lib/message-content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!services().store.getProject(params.projectId)) {
		return json({ error: 'Project not found' }, { status: 404 });
	}
	if (!services().store.hasSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			messageId?: string;
			text?: string;
			images?: unknown;
			attachments?: unknown;
		};
		const messageId = body.messageId?.trim();
		const text = body.text ?? '';
		const { images, attachments } = validateMessageAttachments(body.images, body.attachments);
		if (!messageId || (!text.trim() && !images.length && !attachments.length)) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const accepted = services().dispatcher.submit({
			id: messageId,
			projectId: params.projectId,
			sessionId: params.sessionId,
			text,
			images,
			attachments
		});
		return json({ messageId, ...accepted }, { status: 202 });
	} catch (error) {
		if (error instanceof MessageConflictError) {
			return json({ error: error.message }, { status: 409 });
		}
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!services().store.hasSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as {
			messageId?: string;
			text?: string;
			images?: unknown;
			attachments?: unknown;
			preserveAttachments?: boolean;
		};
		const messageId = body.messageId?.trim();
		const text = body.text ?? '';
		const preserveAttachments = body.preserveAttachments === true;
		const { images, attachments } = validateMessageAttachments(
			body.images,
			preserveAttachments ? [] : body.attachments
		);
		if (!messageId || (!text.trim() && !images.length && !attachments.length)) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const message = services().dispatcher.updateQueuedMessage(messageId, {
			projectId: params.projectId,
			sessionId: params.sessionId,
			text,
			images: preserveAttachments ? [] : images,
			attachments: preserveAttachments ? undefined : attachments
		});
		return json({ message });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
	}
};
