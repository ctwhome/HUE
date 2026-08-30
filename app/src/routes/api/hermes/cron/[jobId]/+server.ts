import { json } from '@sveltejs/kit';
import { requestAccessAllowed } from '$lib/server/access-auth';
import {
	deleteExternalHermesCron,
	getExternalHermesCron,
	setExternalHermesCronEnabled,
	updateExternalHermesCron
} from '$lib/server/external-hermes-cron';
import { redactHermesValue } from '$lib/server/redaction';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

const failure = (cause: unknown, status = 400) =>
	json(
		{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
		{ status }
	);

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		return json({
			job: await getExternalHermesCron(
				services().admin,
				url.searchParams.get('profile') ?? '',
				params.jobId
			)
		});
	} catch (cause) {
		return failure(cause, 503);
	}
};

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!requestAccessAllowed(request, url, getClientAddress()))
		return failure('API access is limited to this device', 403);
	try {
		const input = (await request.json()) as Record<string, unknown>;
		const profile = url.searchParams.get('profile') ?? '';
		const job =
			typeof input.enabled === 'boolean'
				? await setExternalHermesCronEnabled(
						services().admin,
						profile,
						params.jobId,
						input.enabled
					)
				: await updateExternalHermesCron(
						services().admin,
						profile,
						params.jobId,
						input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates)
							? (input.updates as Record<string, unknown>)
							: {}
					);
		return json({ job });
	} catch (cause) {
		return failure(cause);
	}
};

export const DELETE: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!requestAccessAllowed(request, url, getClientAddress()))
		return failure('API access is limited to this device', 403);
	if (url.searchParams.get('confirm') !== params.jobId)
		return failure(`Type ${params.jobId} to confirm deletion`);
	try {
		await deleteExternalHermesCron(
			services().admin,
			url.searchParams.get('profile') ?? '',
			params.jobId
		);
		return json({ deleted: true });
	} catch (cause) {
		return failure(cause);
	}
};
