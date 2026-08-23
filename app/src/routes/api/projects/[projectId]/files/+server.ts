import { json } from '@sveltejs/kit';
import { basename } from 'node:path';
import { ProjectFiles } from '$lib/server/project-files';
import type { FileVersion } from '$lib/server/project-files';
import { authoritativeProject } from '$lib/server/services';
import type { RequestHandler } from './$types';

export function _fileMutationAllowed(request: Request, url: URL, clientAddress?: string) {
	if (!clientAddress) return false;
	const address = clientAddress.replace(/^::ffff:/, '');
	if (!['127.0.0.1', '::1'].includes(address)) return false;
	const host = request.headers.get('host');
	const origin = request.headers.get('origin');
	if (!host || !origin || host !== url.host || origin !== url.origin) return false;
	try {
		return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname);
	} catch {
		return false;
	}
}

export function _parseRange(value: string | null, size: number) {
	if (!value) return { start: 0, end: Math.max(0, size - 1), partial: false };
	if (!value.startsWith('bytes=') || value.includes(',')) throw new Error('Invalid byte range');
	const match = value.match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (!match[1] && !match[2]) || size < 1) throw new Error('Invalid byte range');
	let start: number;
	let end: number;
	if (!match[1]) {
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix < 1) throw new Error('Invalid byte range');
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] ? Number(match[2]) : size - 1;
	}
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		end < start ||
		start >= size
	)
		throw new Error('Invalid byte range');
	return { start, end: Math.min(end, size - 1), partial: true };
}

export function _contentHeaders(name: string, mime: string, download: boolean) {
	const headers = new Headers({
		'content-type': mime,
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; sandbox",
		'accept-ranges': 'bytes',
		'cache-control': 'no-store'
	});
	const ascii =
		basename(name)
			.replace(/[^\x20-\x7e]|["\\]/g, '_')
			.slice(0, 150) || 'download';
	const encoded = encodeURIComponent(basename(name)).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
	headers.set(
		'content-disposition',
		`${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
	);
	return headers;
}

export function _filePath(url: URL) {
	return url.searchParams.get('path') ?? '';
}

async function projectFiles(projectId: string) {
	const project = await authoritativeProject(projectId);
	return new ProjectFiles(project.primary_path);
}

function errorResponse(cause: unknown) {
	const message = cause instanceof Error ? cause.message : String(cause);
	const status =
		message === 'Project not found' || message.includes('not found')
			? 404
			: message.includes('changed outside')
				? 409
				: message.includes('size limit') || message.includes('exceeds')
					? 413
					: 400;
	return json({ error: message }, { status });
}

export const GET: RequestHandler = async ({ params, url, request }) => {
	try {
		const files = await projectFiles(params.projectId);
		const mode = url.searchParams.get('mode') ?? 'tree';
		const path = _filePath(url);
		if (mode === 'tree') {
			return json(
				files.tree({
					maxEntries: Number(url.searchParams.get('maxEntries')) || undefined,
					maxDepth: Number(url.searchParams.get('maxDepth')) || undefined
				})
			);
		}
		if (mode === 'search') return json(files.search(url.searchParams.get('query') ?? ''));
		if (mode === 'preview') return json(files.preview(path));
		if (mode === 'artifacts') return json({ artifacts: files.artifacts() });
		if (mode === 'impact') return json(files.deleteImpact(path));
		if (mode === 'validate') {
			files.preview(path);
			return json({
				path,
				previewUrl: `/api/projects/${encodeURIComponent(params.projectId)}/files?mode=content&path=${encodeURIComponent(path)}`
			});
		}
		if (mode === 'content') {
			const metadata = files.metadata(path);
			if (!metadata.size) {
				const headers = _contentHeaders(
					metadata.name,
					metadata.mime,
					url.searchParams.get('download') === '1'
				);
				headers.set('content-length', '0');
				return new Response(null, { headers });
			}
			const range = _parseRange(request.headers.get('range'), metadata.size);
			const content = files.content(path, range);
			const headers = _contentHeaders(
				metadata.name,
				content.mime,
				url.searchParams.get('download') === '1'
			);
			headers.set('content-length', String(content.length));
			if (range.partial)
				headers.set('content-range', `bytes ${range.start}-${range.end}/${content.size}`);
			return new Response(content.stream, { status: range.partial ? 206 : 200, headers });
		}
		return json({ error: 'Unknown file request' }, { status: 400 });
	} catch (cause) {
		return errorResponse(cause);
	}
};

type Mutation =
	| { action: 'mkdir'; path: string }
	| { action: 'save'; path: string; content: string; expected?: FileVersion }
	| { action: 'move'; path: string; destination: string; expected: FileVersion }
	| { action: 'delete'; path: string; confirmation: string };

export const POST: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!_fileMutationAllowed(request, url, getClientAddress()))
		return json(
			{ error: 'Project file mutations require loopback same-origin access' },
			{ status: 403 }
		);
	try {
		const files = await projectFiles(params.projectId);
		const body = (await request.json()) as Partial<Mutation>;
		if (typeof body.action !== 'string' || typeof body.path !== 'string')
			throw new Error('Invalid file mutation');
		if (body.action === 'mkdir') files.createDirectory(body.path);
		else if (body.action === 'save') {
			if (typeof body.content !== 'string') throw new Error('File content must be text');
			return json(files.save(body.path, body.content, body.expected));
		} else if (body.action === 'move') {
			if (typeof body.destination !== 'string' || !body.expected)
				throw new Error('Move requires destination and file version');
			files.move(body.path, body.destination, body.expected);
		} else if (body.action === 'delete') {
			if (typeof body.confirmation !== 'string') throw new Error('Delete confirmation is required');
			files.remove(body.path, body.confirmation);
		} else throw new Error('Unknown file mutation');
		return json({ success: true });
	} catch (cause) {
		return errorResponse(cause);
	}
};

export const PUT: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	if (!_fileMutationAllowed(request, url, getClientAddress()))
		return json(
			{ error: 'Project file mutations require loopback same-origin access' },
			{ status: 403 }
		);
	try {
		const length = Number(request.headers.get('content-length') ?? '0');
		if (length > ProjectFiles.MAX_UPLOAD_BYTES) throw new Error('Upload exceeds size limit');
		const path = _filePath(url);
		if (!path) throw new Error('Upload path is required');
		const bytes = new Uint8Array(await request.arrayBuffer());
		return json((await projectFiles(params.projectId)).upload(path, bytes));
	} catch (cause) {
		return errorResponse(cause);
	}
};
