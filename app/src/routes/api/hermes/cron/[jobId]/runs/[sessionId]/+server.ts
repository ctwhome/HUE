import { json } from '@sveltejs/kit';
import { requestAccessAllowed } from '$lib/server/access-auth';
import { redactHermesValue } from '$lib/server/redaction';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

const failure = (cause: unknown, status: number) =>
	json(
		{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
		{ status }
	);

export const GET: RequestHandler = async ({ params, url }) => {
	const profile = url.searchParams.get('profile') ?? '';
	const run = services().store.getExternalCronRun(profile, params.jobId, params.sessionId);
	if (!run) return failure('Hermes cron run not found', 404);
	try {
		return json({
			run,
			messages: await services().admin.loadTranscript(params.sessionId, profile)
		});
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!requestAccessAllowed(request, url, getClientAddress()))
		return failure('API access is limited to this device', 403);
	const profile = url.searchParams.get('profile') ?? '';
	if (!services().store.markExternalCronRunRead(profile, params.jobId, params.sessionId))
		return failure('Hermes cron run not found', 404);
	return json({ read: true });
};
