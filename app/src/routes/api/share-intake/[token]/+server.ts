import { json } from '@sveltejs/kit';
import { shareIntakes } from '$lib/server/share-intake';
import type { RequestHandler } from './$types';

const headers = {
	'cache-control': 'private, no-store, max-age=0',
	'content-security-policy': "default-src 'none'",
	'referrer-policy': 'no-referrer'
};

export const GET: RequestHandler = async ({ params }) => {
	if (!/^[0-9a-f-]{36}$/i.test(params.token))
		return json({ error: 'Share intake unavailable' }, { status: 410, headers });
	const intake = shareIntakes.consume(params.token);
	return intake
		? json(intake, { headers })
		: json({ error: 'Share intake expired or already used' }, { status: 410, headers });
};
