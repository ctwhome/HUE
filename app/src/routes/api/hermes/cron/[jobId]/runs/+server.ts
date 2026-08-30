import { json } from '@sveltejs/kit';
import { redactHermesValue } from '$lib/server/redaction';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const profile = url.searchParams.get('profile') ?? '';
	try {
		await services().externalCron.refreshJob(profile, params.jobId);
		return json({ runs: services().store.listExternalCronRuns(profile, params.jobId) });
	} catch (cause) {
		return json(
			{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
			{ status: 503 }
		);
	}
};
