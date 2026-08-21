import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { MessageConflictError } from '$lib/server/store';
import { validateImageAttachments } from '$lib/message-content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!services().store.getProject(params.projectId)) {
		return json({ error: 'Project not found' }, { status: 404 });
	}
	if (!services().store.hasProjectSession(params.projectId, params.sessionId)) {
		return json({ error: 'Session not found' }, { status: 404 });
	}
	try {
		const body = (await request.json()) as { messageId?: string; text?: string; images?: unknown };
		const messageId = body.messageId?.trim();
		const text = body.text ?? '';
		const images = validateImageAttachments(body.images);
		if (!messageId || (!text.trim() && !images.length)) {
			return json({ error: 'messageId and message content are required' }, { status: 400 });
		}
		const accepted = services().dispatcher.submit({
			id: messageId,
			projectId: params.projectId,
			sessionId: params.sessionId,
			text,
			images
		});
		return json({ messageId, ...accepted }, { status: 202 });
	} catch (error) {
		if (error instanceof MessageConflictError) {
			return json({ error: error.message }, { status: 409 });
		}
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
