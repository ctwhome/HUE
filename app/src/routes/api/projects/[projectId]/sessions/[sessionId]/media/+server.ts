import { json } from '@sveltejs/kit';
import { authoritativeProject, services } from '$lib/server/route-services';
import {
	closeSessionMedia,
	resolveSessionMedia,
	serveSessionMedia
} from '$lib/server/session-media';
import type { RequestHandler } from './$types';

async function getMedia(
	params: { projectId: string; sessionId: string },
	url: URL,
	request: Request,
	head = false
) {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	const session = services().store.getSession(project.id, params.sessionId);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });
	try {
		const media = resolveSessionMedia(session.cwd, url.searchParams.get('path') ?? '');
		const download = url.searchParams.get('download') === 'true';
		return serveSessionMedia(media, request, download, head);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
}

export const GET: RequestHandler = ({ params, url, request }) => getMedia(params, url, request);
export const HEAD: RequestHandler = ({ params, url, request }) =>
	getMedia(params, url, request, true);

export const POST: RequestHandler = async ({ params, request }) => {
	let project;
	try {
		project = await authoritativeProject(params.projectId);
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 404 });
	}
	const session = services().store.getSession(project.id, params.sessionId);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });
	try {
		const body = (await request.json()) as { path?: string; action?: string };
		if (body.action !== 'open' && body.action !== 'reveal')
			return json({ error: 'Action must be open or reveal' }, { status: 400 });
		const media = resolveSessionMedia(session.cwd, body.path ?? '');
		try {
			const process = Bun.spawn(
				body.action === 'reveal' ? ['open', '-R', media.path] : ['open', media.path],
				{ stdout: 'ignore', stderr: 'pipe' }
			);
			if (await process.exited)
				throw new Error(
					(await new Response(process.stderr).text()) || `open exited ${process.exitCode}`
				);
			return json({ opened: true, action: body.action, provenance: media.provenance });
		} finally {
			closeSessionMedia(media);
		}
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
