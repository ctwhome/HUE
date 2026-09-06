import { json } from '@sveltejs/kit';
import {
	normalizeBrowserUrl,
	parseStoredBrowserScene,
	serializeBrowserScene
} from '$lib/components/workbench/browser-canvas';
import { authoritativeProject, services } from '$lib/server/services';
import { ProjectExcalidrawConflictError } from '$lib/server/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		return json({ state: services().store.getProjectExcalidraw(project.id) });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const project = await authoritativeProject(params.projectId);
		const body = (await request.json()) as {
			address?: unknown;
			scene?: unknown;
			expectedUpdatedAt?: unknown;
		};
		if (
			!Object.hasOwn(body, 'expectedUpdatedAt') ||
			(body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')
		) {
			throw new Error('Excalidraw revision is required');
		}
		const input: { address?: string; scene?: string } = {};
		if (body.address !== undefined) {
			if (typeof body.address !== 'string') throw new Error('Excalidraw address must be a string');
			input.address = body.address ? normalizeBrowserUrl(body.address) : '';
		}
		if (body.scene !== undefined) {
			if (typeof body.scene !== 'string') throw new Error('Excalidraw scene must be a string');
			const scene = parseStoredBrowserScene(body.scene);
			if (!scene) throw new Error('Excalidraw scene is invalid');
			input.scene = serializeBrowserScene(scene.elements, scene.appState);
		}
		if (input.address === undefined && input.scene === undefined) {
			throw new Error('Excalidraw address or scene is required');
		}
		return json({
			state: services().store.updateProjectExcalidraw(
				project.id,
				input,
				body.expectedUpdatedAt as string | null
			)
		});
	} catch (cause) {
		return json(
			{ error: cause instanceof Error ? cause.message : String(cause) },
			{ status: cause instanceof ProjectExcalidrawConflictError ? 409 : 400 }
		);
	}
};
