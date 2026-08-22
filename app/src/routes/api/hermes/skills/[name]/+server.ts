import { json } from '@sveltejs/kit';
import { readHermesSkill, writeHermesSkill } from '$lib/server/hermes-skills';
import type { RequestHandler } from './$types';

function failure(cause: unknown) {
	const error = cause instanceof Error ? cause.message : String(cause);
	return json({ error }, { status: error.includes('not found') ? 404 : 400 });
}

export const GET: RequestHandler = ({ params }) => {
	try {
		return json(readHermesSkill(params.name));
	} catch (cause) {
		return failure(cause);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json()) as { content?: unknown };
		if (typeof body.content !== 'string') return json({ error: 'content is required' }, { status: 400 });
		return json(writeHermesSkill(params.name, body.content));
	} catch (cause) {
		return failure(cause);
	}
};
