import { json } from '@sveltejs/kit';
import { services } from '$lib/server/services';
import type { RequestHandler } from './$types';

export function _terminalAllowed(
	request: Request,
	url: URL,
	clientAddress: string,
	mutation: boolean
) {
	const address = clientAddress.replace(/^::ffff:/, '');
	const host = request.headers.get('host') ?? url.host;
	let hostname = '';
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return false;
	}
	if (
		!['127.0.0.1', '::1'].includes(address) ||
		!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
	) {
		return false;
	}
	if (!mutation) return true;
	const origin = request.headers.get('origin');
	if (!origin) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

export const GET: RequestHandler = ({ params, request, url, getClientAddress }) => {
	if (!_terminalAllowed(request, url, getClientAddress(), false)) {
		return json({ error: 'Terminal access is limited to this device' }, { status: 403 });
	}
	if (!services().store.getProject(params.projectId)) {
		return json({ error: 'Project not found' }, { status: 404 });
	}
	try {
		return json(
			services().terminals.read(
				params.projectId,
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
	const project = services().store.getProject(params.projectId);
	if (!project) return json({ error: 'Project not found' }, { status: 404 });
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
			return json(
				services().terminals.create(
					params.projectId,
					project.rootPath,
					body.cols ?? 80,
					body.rows ?? 24
				)
			);
		}
		if (!body.terminalId) throw new Error('Terminal ID is required');
		if (body.action === 'input') {
			services().terminals.write(
				params.projectId,
				body.terminalId,
				body.sequence ?? 0,
				body.data ?? ''
			);
		} else if (body.action === 'resize') {
			services().terminals.resize(
				params.projectId,
				body.terminalId,
				body.cols ?? 0,
				body.rows ?? 0
			);
		} else if (body.action === 'close') {
			services().terminals.close(params.projectId, body.terminalId);
		} else {
			throw new Error('Unknown terminal action');
		}
		return json({ success: true });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	}
};
