import { json } from '@sveltejs/kit';
import { createDirectory, listDirectories } from '$lib/server/directory-browser';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	try {
		return json(
			listDirectories(
				url.searchParams.get('path') ?? undefined,
				url.searchParams.get('hidden') === 'true'
			)
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as { parent?: unknown; name?: unknown; hidden?: unknown };
		if (typeof body.parent !== 'string' || typeof body.name !== 'string') {
			throw new Error('Parent path and folder name are required');
		}
		createDirectory(body.parent, body.name);
		return json(listDirectories(body.parent, body.hidden === true), { status: 201 });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
