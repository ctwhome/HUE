import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

function projectIcon(input: unknown): string | null {
	if (input == null || input === '') return null;
	if (typeof input !== 'string') throw new Error('Project icon must be an emoji or image');
	const icon = input.trim();
	if (!icon) return null;
	const image = icon.match(
		/^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/
	);
	if (image) {
		if (Math.ceil((image[2].length * 3) / 4) > 1024 * 1024) {
			throw new Error('Project icon image must be 1 MB or smaller');
		}
		return icon;
	}
	if (icon.startsWith('data:') || Array.from(icon).length > 8) {
		throw new Error('Project icon must be a short emoji or a PNG, JPEG, GIF, or WebP image');
	}
	return icon;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = (await request.json()) as { name?: string; icon?: unknown };
		const name = body.name?.trim();
		if (!name) return json({ error: 'Project name is required' }, { status: 400 });
		const existing = services().store.getProject(params.projectId);
		if (!existing) return json({ error: 'Project not found' }, { status: 404 });
		const project = services().store.updateProject(params.projectId, {
			name,
			icon: 'icon' in body ? projectIcon(body.icon) : existing.icon
		});
		return json({ project });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	return services().store.deleteProject(params.projectId)
		? json({ deleted: true })
		: json({ error: 'Project not found' }, { status: 404 });
};
