import { json } from '@sveltejs/kit';
import { discardQuickAsk, generateQuickAsk, keepQuickAsk } from '$lib/server/quick-ask';
import { services, unprojectedSessionRoot } from '$lib/server/route-services';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import type { RequestHandler } from './$types';

function allowed(request: Request, url: URL) {
	return sameOriginMutationAllowed(request, url);
}

export const POST: RequestHandler = async ({ request, url }) => {
	if (!allowed(request, url))
		return json({ error: 'Quick Ask requires a same-origin request' }, { status: 403 });
	try {
		const body = (await request.json()) as { question?: unknown; operationId?: unknown };
		if (
			typeof body.question !== 'string' ||
			!body.question.trim() ||
			body.question.length > 20_000 ||
			typeof body.operationId !== 'string'
		)
			throw new Error('Invalid Quick Ask request');
		return json(
			await generateQuickAsk(
				{
					question: body.question,
					operationId: body.operationId,
					sessionRoot: unprojectedSessionRoot()
				},
				services()
			)
		);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};

export const PATCH: RequestHandler = async ({ request, url }) => {
	if (!allowed(request, url))
		return json({ error: 'Quick Ask requires a same-origin request' }, { status: 403 });
	try {
		const body = (await request.json()) as { operationId?: unknown };
		if (typeof body.operationId !== 'string') throw new Error('Invalid Quick Ask request');
		const session = keepQuickAsk(services().store, body.operationId);
		return json({ session, path: `/?project=none&session=${encodeURIComponent(session.sessionId)}` });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request, url }) => {
	if (!allowed(request, url))
		return json({ error: 'Quick Ask requires a same-origin request' }, { status: 403 });
	try {
		const body = (await request.json()) as { operationId?: unknown };
		if (typeof body.operationId !== 'string') throw new Error('Invalid Quick Ask request');
		await discardQuickAsk(services().store, services().runtime, body.operationId);
		return json({ removed: true, hermesTranscriptRetained: true });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
