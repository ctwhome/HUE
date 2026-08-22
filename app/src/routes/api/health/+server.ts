import { json } from '@sveltejs/kit';
import { projectRuntimeHealth, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const projectId = url.searchParams.get('projectId');
	const project = projectId ? services().store.getProject(projectId) : null;
	if (projectId && !project) return json({ error: 'Project not found' }, { status: 404 });
	const checks = project
		? projectRuntimeHealth(project.rootPath, {
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
