import { json } from '@sveltejs/kit';
import { validateIcon } from '$lib/icon';
import { validateProjectColor } from '$lib/project-color';
import {
	HermesProjectMutationError,
	HermesProjectsCapabilityError
} from '$lib/server/hermes-projects';
import { findProjectFavicon } from '$lib/server/project-icon';
import { projectView, services, trustedProjectRoot } from '$lib/server/route-services';
import type { RequestHandler } from './$types';

function errorStatus(cause: unknown) {
	if (cause instanceof HermesProjectsCapabilityError) return 503;
	const message = cause instanceof Error ? cause.message : String(cause);
	return message.includes('not found') || message.includes('no such project') ? 404 : 400;
}

function optionalLabel(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	if (typeof value !== 'string' || value.length > 200 || value.includes('\0')) {
		throw new Error('Folder label is invalid');
	}
	return value.trim() || null;
}

function projectGroup(value: unknown): string | null {
	if (value !== null && typeof value !== 'string') throw new Error('Project group is invalid');
	const group = value?.trim() || null;
	if ((group?.length ?? 0) > 100 || group?.includes('\0')) throw new Error('Project group is invalid');
	return group;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	let attempted = false;
	let closeTerminals = false;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		if (body.action === 'set_color') {
			const color = validateProjectColor(body.color);
			const state = services();
			const current = await state.projects.get(params.projectId);
			state.store.ensureProjectMetadata(current.id);
			state.store.updateProjectColor(current.id, color);
			return json({
				project: projectView(current, color, state.store.getProjectGroup(current.id))
			});
		}
		if (body.action === 'set_group') {
			if (body.group !== null && typeof body.group !== 'string') {
				throw new Error('Project group must be text');
			}
			const group = typeof body.group === 'string' ? body.group.trim() || null : null;
			if (group && (group.length > 100 || group.includes('\0'))) {
				throw new Error('Project group must be 100 characters or fewer');
			}
			const state = services();
			const current = await state.projects.get(params.projectId);
			state.store.ensureProjectMetadata(current.id);
			state.store.updateProjectGroup(current.id, group);
			return json({
				project: projectView(current, state.store.getProjectColor(current.id), group)
			});
		}
		let project;
		if (body.action === 'auto_icon') {
			const current = await services().projects.get(params.projectId);
			attempted = true;
			project = await services().projects.update(current.id, {
				icon: findProjectFavicon(current.primary_path)
			});
		} else if (body.action === 'update') {
			if (body.name === undefined && body.icon === undefined) {
				throw new Error('Project name or icon is required');
			}
			if (body.name !== undefined && typeof body.name !== 'string') {
				throw new Error('Project name must be text');
			}
			const name = typeof body.name === 'string' ? body.name.trim() : undefined;
			if (body.name !== undefined && !name) throw new Error('Project name is required');
			const icon = body.icon !== undefined ? validateIcon(body.icon) : undefined;
			attempted = true;
			project = await services().projects.update(params.projectId, { name, icon });
		} else if (body.action === 'add_folder') {
			if (typeof body.path !== 'string') throw new Error('Project folder must be a path');
			if (body.isPrimary !== undefined && typeof body.isPrimary !== 'boolean') {
				throw new Error('Primary choice must be true or false');
			}
			const path = trustedProjectRoot(body.path);
			attempted = true;
			closeTerminals = body.isPrimary === true;
			project = await services().projects.addFolder(params.projectId, path, {
				label: optionalLabel(body.label),
				isPrimary: body.isPrimary === true
			});
		} else if (body.action === 'remove_folder') {
			if (typeof body.path !== 'string') throw new Error('Project folder must be a path');
			if (body.replacementPrimary !== undefined && typeof body.replacementPrimary !== 'string') {
				throw new Error('Replacement primary folder must be a path');
			}
			const replacement =
				typeof body.replacementPrimary === 'string'
					? trustedProjectRoot(body.replacementPrimary)
					: undefined;
			attempted = true;
			closeTerminals = true;
			project = await services().projects.removeFolder(params.projectId, body.path, replacement);
		} else if (body.action === 'set_primary') {
			if (typeof body.path !== 'string') throw new Error('Primary folder must be a path');
			const path = trustedProjectRoot(body.path);
			attempted = true;
			closeTerminals = true;
			project = await services().projects.setPrimary(params.projectId, path);
		} else {
			throw new Error('Unknown Project update');
		}
		if (closeTerminals) services().terminals.closeProject(project.id);
		return json({
			project: projectView(
				project,
				services().store.getProjectColor(project.id),
				services().store.getProjectGroup(project.id)
			)
		});
	} catch (cause) {
		let project =
			cause instanceof HermesProjectMutationError
				? projectView(
						cause.project,
						services().store.getProjectColor(cause.project.id),
						services().store.getProjectGroup(cause.project.id)
					)
				: null;
		if (attempted && !project) {
			try {
				const current = await services().projects.get(params.projectId);
				project = projectView(
					current,
					services().store.getProjectColor(current.id),
					services().store.getProjectGroup(current.id)
				);
			} catch {
				// Original mutation failure remains authoritative.
			}
		}
		if (closeTerminals && project) services().terminals.closeProject(project.id);
		return json(
			{
				error: cause instanceof Error ? cause.message : String(cause),
				project,
				...(cause instanceof HermesProjectMutationError
					? {
							restored: cause.restored,
							reconciliationRequired: cause.reconciliationRequired
						}
					: {})
			},
			{ status: errorStatus(cause) }
		);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const archived = await services().projectOperations.archive(params.projectId);
		services().terminals.closeProject(archived.id);
		return json({ archived: true });
	} catch (cause) {
		return json(
			{ error: cause instanceof Error ? cause.message : String(cause) },
			{ status: errorStatus(cause) === 400 ? 409 : errorStatus(cause) }
		);
	}
};
