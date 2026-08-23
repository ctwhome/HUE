import { text } from '@sveltejs/kit';
import { parseShareForm, shareIntakes } from '$lib/server/share-intake';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	text('Web Share Target requires POST', {
		status: 405,
		headers: { allow: 'POST', 'cache-control': 'no-store' }
	});

export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('origin') !== new URL(request.url).origin)
		return text('Shared content was rejected', {
			status: 403,
			headers: { 'cache-control': 'no-store' }
		});
	try {
		const intake = await parseShareForm(await request.formData());
		const token = shareIntakes.put(intake);
		return new Response(null, {
			status: 303,
			headers: {
				location: `/?intent=share&token=${encodeURIComponent(token)}`,
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer'
			}
		});
	} catch {
		return text('Shared content was rejected', {
			status: 400,
			headers: { 'cache-control': 'no-store' }
		});
	}
};
