import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { text?: unknown };
		if (typeof body.text !== 'string' || !body.text.trim()) {
			return json({ error: 'Speech text is required' }, { status: 400 });
		}
		if (body.text.length > 20_000) {
			return json({ error: 'Speech text is too long' }, { status: 413 });
		}
		return await services().admin.speakAudio(body.text, request.signal);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
