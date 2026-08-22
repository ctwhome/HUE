import { json } from '@sveltejs/kit';
import { authoritativeProject, projectRuntimeHealth, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const projectId = url.searchParams.get('projectId');
	let project = null;
	try {
		project = projectId ? await authoritativeProject(projectId) : null;
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	const checks = project
		? projectRuntimeHealth(project.primary_path, {
				acp: services().runtime.healthStatus(),
				admin: services().admin.healthStatus()
			})
		: [];
	return json({
		ok: checks.every(({ status }) => status !== 'blocked' && status !== 'unavailable'),
		service: 'hue-workspace',
		runtime: 'bun',
		protocol: 'acp-v1',
		checks
	});
};
