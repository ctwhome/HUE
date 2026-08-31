import { json } from '@sveltejs/kit';
import { requestAccessAllowed } from '$lib/server/access-auth';
import { requestOriginMatches } from '$lib/server/same-origin';
import { authoritativeProject, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export function _terminalAllowed(
	request: Request,
	url: URL,
	clientAddress: string,
	mutation: boolean,
	secret = process.env.HUE_ACCESS_SECRET
) {
	if (mutation && !requestOriginMatches(request, url)) return false;
	return requestAccessAllowed(request, url, clientAddress, secret);
}

export const GET: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!_terminalAllowed(request, url, getClientAddress(), false)) {
		return json({ error: 'Terminal access is limited to this device' }, { status: 403 });
	}
	try {
		const project = await authoritativeProject(params.projectId);
		return json(
			services().terminals.read(
				project.id,
				url.searchParams.get('terminalId') ?? '',
				Number(url.searchParams.get('after') ?? 0)
			)
		);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
	}
};

export const POST: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!_terminalAllowed(request, url, getClientAddress(), true)) {
		return json({ error: 'Terminal access is limited to this device' }, { status: 403 });
	}
	try {
		const project = await authoritativeProject(params.projectId);
		const body = (await request.json()) as {
			action?: string;
			terminalId?: string;
			sequence?: number;
			data?: string;
			cols?: number;
			rows?: number;
		};
		if (body.action === 'create') {
			return json(
				services().terminals.create(
					project.id,
					project.primary_path,
					body.cols ?? 80,
					body.rows ?? 24
				)
			);
		}
		if (!body.terminalId) throw new Error('Terminal ID is required');
		if (body.action === 'input') {
			services().terminals.write(project.id, body.terminalId, body.sequence ?? 0, body.data ?? '');
		} else if (body.action === 'resize') {
			services().terminals.resize(project.id, body.terminalId, body.cols ?? 0, body.rows ?? 0);
		} else if (body.action === 'close') {
			services().terminals.close(project.id, body.terminalId);
		} else {
			throw new Error('Unknown terminal action');
		}
		return json({ success: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
