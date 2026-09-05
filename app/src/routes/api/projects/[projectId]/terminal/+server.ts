import { json } from '@sveltejs/kit';
import { requestAccessAllowed } from '$lib/server/access-auth';
import { requestOriginMatches } from '$lib/server/same-origin';
import { authoritativeProject, services } from '$lib/server/services';
import type { RequestHandler } from './$types';

const terminalProjectIds = new Map<string, string>();

async function terminalProjectId(reference: string) {
	const cached = terminalProjectIds.get(reference);
	if (cached) return cached;
	const project = await authoritativeProject(reference);
	terminalProjectIds.set(reference, project.id);
	return project.id;
}

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
		return json(
			services().terminals.read(
				await terminalProjectId(params.projectId),
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
		const body = (await request.json()) as {
			action?: string;
			terminalId?: string;
			sequence?: number;
			data?: string;
			cols?: number;
			rows?: number;
		};
		if (body.action === 'create') {
			const project = await authoritativeProject(params.projectId);
			terminalProjectIds.set(params.projectId, project.id);
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
		const projectId = await terminalProjectId(params.projectId);
		if (body.action === 'input') {
			services().terminals.write(projectId, body.terminalId, body.sequence ?? 0, body.data ?? '');
		} else if (body.action === 'resize') {
			services().terminals.resize(projectId, body.terminalId, body.cols ?? 0, body.rows ?? 0);
		} else if (body.action === 'close') {
			services().terminals.close(projectId, body.terminalId);
		} else {
			throw new Error('Unknown terminal action');
		}
		return json({ success: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
