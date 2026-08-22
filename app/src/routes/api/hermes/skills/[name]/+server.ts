import { json } from '@sveltejs/kit';
import { redactHermesValue } from '$lib/server/redaction';
import {
	deleteHermesSkill,
	hermesSkillsRoot,
	readHermesSkill,
	writeHermesSkill
} from '$lib/server/hermes-skills';
import { localApiAllowed } from '$lib/server/local-api';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

function failure(cause: unknown) {
	const error = String(redactHermesValue(cause instanceof Error ? cause.message : String(cause)));
	return json({ error }, { status: error.includes('not found') ? 404 : 400 });
}

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json(readHermesSkill(params.name, hermesSkillsRoot(services().admin.profileName())));
	} catch (cause) {
		return failure(cause);
	}
};

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!localApiAllowed(request, url, getClientAddress())) {
		return json({ error: 'API access is limited to this device' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as { content?: unknown };
		if (typeof body.content !== 'string')
			return json({ error: 'content is required' }, { status: 400 });
		return json(
			writeHermesSkill(params.name, body.content, hermesSkillsRoot(services().admin.profileName()))
		);
	} catch (cause) {
		return failure(cause);
	}
};

export const DELETE: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!localApiAllowed(request, url, getClientAddress())) {
		return json({ error: 'API access is limited to this device' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as { confirm?: unknown };
		if (body.confirm !== params.name) return failure(`Type ${params.name} to confirm deletion`);
		const deleted = deleteHermesSkill(
			params.name,
			hermesSkillsRoot(services().admin.profileName())
		);
		return json({ deleted, verifiedAbsent: true });
	} catch (cause) {
		return failure(cause);
	}
};
