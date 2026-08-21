import { json } from '@sveltejs/kit';
import { listDirectories } from '$lib/server/directory-browser';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	try {
		return json(
			listDirectories(url.searchParams.get('path') ?? undefined, url.searchParams.get('hidden') === 'true')
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
