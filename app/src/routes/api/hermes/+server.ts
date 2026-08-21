import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { readHermesPanel, type HermesPanel } from '$lib/server/hermes-cli';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const view = url.searchParams.get('view');
		if (view === 'skills' || view === 'schedules' || view === 'profiles') {
			return json(readHermesPanel(view as HermesPanel));
		}
		await services().runtime.start();
		return json(services().runtime.getRuntimeInfo());
	} catch (cause) {
		return json(
			{ error: cause instanceof Error ? cause.message : String(cause) },
			{ status: 503 }
		);
	}
};
