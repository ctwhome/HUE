import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { attachmentMatchesDeclaredType } from '$lib/message-content';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { dataUrl?: unknown; mimeType?: unknown };
		if (typeof body.dataUrl !== 'string' || typeof body.mimeType !== 'string') {
			return json({ error: 'Audio data and MIME type are required' }, { status: 400 });
		}
		const mimeType = body.mimeType.split(';', 1)[0].toLowerCase();
		const comma = body.dataUrl.indexOf(',');
		const header = comma >= 0 ? body.dataUrl.slice(0, comma) : '';
		const declaredMimeType = header.slice(5).split(';', 1)[0].toLowerCase();
		const encoded = comma >= 0 ? body.dataUrl.slice(comma + 1) : '';
		if (
			!['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'].includes(
				mimeType
			) ||
			declaredMimeType !== mimeType ||
			!header.includes(';base64') ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
		) {
			return json({ error: 'A supported base64 audio recording is required' }, { status: 400 });
		}
		if (body.dataUrl.length > 32 * 1024 * 1024) {
			return json({ error: 'Audio recording is too large' }, { status: 413 });
		}
		if (!attachmentMatchesDeclaredType(mimeType, Buffer.from(encoded, 'base64'))) {
			return json({ error: 'Audio content does not match its MIME type' }, { status: 400 });
		}
		return json(
			await services().admin.transcribeAudio(body.dataUrl, body.mimeType, request.signal)
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
	}
};
