import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { validateProjectColor } from '$lib/project-color';
import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import {
	loadProjectViews,
	projectView,
	services,
	trustedProjectRoot
} from '$lib/server/route-services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const loaded = await loadProjectViews();
		return json({ ...loaded, projectsCapability: 'available' });
	} catch (cause) {
		const capabilityMissing = cause instanceof HermesProjectsCapabilityError;
		return json(
			{
				error: cause instanceof Error ? cause.message : String(cause),
				projects: [],
				projectsCapability: capabilityMissing ? 'unavailable' : 'outage'
			},
			{ status: 503 }
		);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			name?: unknown;
			icon?: unknown;
			color?: unknown;
			group?: unknown;
			folders?: unknown;
			primaryPath?: unknown;
		};
		if (typeof body.name !== 'string' || !body.name.trim()) {
			throw new Error('Project name is required');
		}
		if (!Array.isArray(body.folders) || !body.folders.length) {
			throw new Error('Project requires at least one folder');
		}
		if (body.folders.some((folder) => typeof folder !== 'string')) {
			throw new Error('Project folders must be paths');
		}
		if (typeof body.primaryPath !== 'string') throw new Error('Primary folder is required');
		const folders = body.folders.map((folder) => trustedProjectRoot(String(folder)));
		if (new Set(folders).size !== folders.length) throw new Error('Project folders must be unique');
		const primaryPath = trustedProjectRoot(body.primaryPath);
		if (!folders.includes(primaryPath))
			throw new Error('Primary folder must be one selected folder');
		const icon = body.icon === undefined ? undefined : validateIcon(body.icon);
		const color = body.color == null ? null : validateProjectColor(body.color);
		if (body.group != null && typeof body.group !== 'string') {
			throw new Error('Project section must be text');
		}
		const group = typeof body.group === 'string' ? body.group.trim() || null : null;
		if (group && (group.length > 100 || group.includes('\0'))) {
			throw new Error('Project section must be 100 characters or fewer');
		}
		const project = await services().projects.create({
			name: body.name.trim(),
			icon,
			folders,
			primaryPath
		});
		services().store.ensureProjectMetadata(project.id, project.name);
		if (color) services().store.updateProjectColor(project.id, color);
		if (group) services().store.updateProjectGroup(project.id, group);
		return json({ project: projectView(project, color, group) }, { status: 201 });
	} catch (cause) {
		return json(
			{ error: cause instanceof Error ? cause.message : String(cause) },
			{ status: cause instanceof HermesProjectsCapabilityError ? 503 : 400 }
		);
	}
};
