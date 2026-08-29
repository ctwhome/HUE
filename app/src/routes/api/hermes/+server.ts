import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import { HermesAdmin, type HermesAdminView } from '$lib/server/hermes-admin';
import { redactHermesValue } from '$lib/server/redaction';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const view = url.searchParams.get('view');
		if (view === 'schedules') {
			return json({ capabilities: { schedules: true }, jobs: services().schedules.list() });
		}
		if (['memory', 'skills', 'profiles', 'mcp', 'models'].includes(view ?? '')) {
			const result = await new HermesAdmin(services().admin).view(view as HermesAdminView);
			return json(
				view === 'profiles'
					? { ...result, runningAcpProfile: services().runtime.getRuntimeInfo().profile }
					: result
			);
		}
		await services().runtime.start();
		const runtime = services().runtime.getRuntimeInfo();
		const administration = await new HermesAdmin(services().admin).view('runtime');
		return json(redactHermesValue({ ...runtime, administration }));
	} catch (cause) {
		return json(
			{ error: redactHermesValue(cause instanceof Error ? cause.message : String(cause)) },
			{ status: 503 }
		);
	}
};
