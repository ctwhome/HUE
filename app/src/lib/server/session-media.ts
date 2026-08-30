import {
	closeSync,
	constants,
	createReadStream,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync
} from 'node:fs';
import { Readable } from 'node:stream';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
	attachmentLimits,
	attachmentMatchesDeclaredType,
	mimeTypeForFile
} from '$lib/message-content';

const signatureTypes = new Set([
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/zip',
	'application/gzip',
	'application/x-tar',
	'application/x-7z-compressed',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'audio/mpeg',
	'audio/wav',
	'audio/ogg',
	'audio/mp4',
	'video/mp4',
	'video/webm',
	'video/quicktime'
]);

const svgContentSecurityPolicy =
	"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";
const htmlContentSecurityPolicy =
	"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox";

function isSvg(bytes: Uint8Array) {
	try {
		const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return /^(?:\uFEFF|\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)*<svg(?:\s|>)/i.test(source);
	} catch {
		return false;
	}
}

function isUtf8Text(bytes: Uint8Array) {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

function safeDisposition(name: string, download: boolean) {
	const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
	return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function parseRange(value: string | null, size: number): [number, number] | null | false {
	if (!value) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2]) || size === 0) return false;
	let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	let end = match[2] && match[1] ? Number(match[2]) : size - 1;
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
		return false;
	end = Math.min(end, size - 1);
	return [start, end];
}

export function resolveSessionMedia(root: string, source: string) {
	if (!source || isAbsolute(source)) throw new Error('MEDIA path must be relative to Session root');
	const canonicalRoot = realpathSync(root);
	const unresolved = resolve(canonicalRoot, source);
	const sourceBoundary = relative(canonicalRoot, unresolved);
	if (!sourceBoundary || sourceBoundary.startsWith('..') || isAbsolute(sourceBoundary)) {
		throw new Error('MEDIA path is outside Session root');
	}
	let part = canonicalRoot;
	for (const segment of sourceBoundary.split(sep)) {
		part = resolve(part, segment);
		if (lstatSync(part).isSymbolicLink()) throw new Error('MEDIA path must not contain symlinks');
	}
	const descriptor = openSync(unresolved, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const candidate = realpathSync(`/dev/fd/${descriptor}`);
		const boundary = relative(canonicalRoot, candidate);
		if (!boundary || boundary.startsWith('..') || isAbsolute(boundary)) {
			throw new Error('MEDIA path is outside Session root');
		}
		const stat = fstatSync(descriptor);
		if (!stat.isFile()) throw new Error('MEDIA output is not a regular file');
		const extension = extname(candidate).toLowerCase();
		const mimeType =
			mimeTypeForFile(candidate) ??
			(extension === '.svg'
				? 'image/svg+xml'
				: extension === '.html' || extension === '.htm'
					? 'text/html'
					: null);
		if (!mimeType) throw new Error('MEDIA output type is not allowed');
		if (/\p{C}/u.test(basename(candidate)))
			throw new Error('MEDIA file name contains unsafe characters');
		if (signatureTypes.has(mimeType) || mimeType === 'image/svg+xml') {
			const bytes = new Uint8Array(mimeType === 'image/svg+xml' ? 64 * 1024 : 512);
			const length = readSync(descriptor, bytes, 0, bytes.length, 0);
			if (
				!(mimeType === 'image/svg+xml'
					? isSvg(bytes.subarray(0, length))
					: attachmentMatchesDeclaredType(mimeType, bytes.subarray(0, length)))
			) {
				throw new Error('MEDIA content does not match its file type');
			}
		}
		if (mimeType === 'text/html') {
			if (stat.size > attachmentLimits.maxTextBytes)
				throw new Error('MEDIA text output is too large');
			const bytes = new Uint8Array(stat.size);
			readSync(descriptor, bytes, 0, bytes.length, 0);
			if (!isUtf8Text(bytes)) throw new Error('MEDIA content does not match its file type');
		}
		return {
			descriptor,
			path: candidate,
			name: basename(candidate),
			mimeType,
			size: stat.size,
			provenance: `Hermes MEDIA: ${source}`
		};
	} catch (error) {
		closeSync(descriptor);
		throw error;
	}
}

export function closeSessionMedia(media: ReturnType<typeof resolveSessionMedia>) {
	closeSync(media.descriptor);
}

export function serveSessionMedia(
	media: ReturnType<typeof resolveSessionMedia>,
	request: Request,
	download: boolean,
	head = false
) {
	const range = parseRange(request.headers.get('range'), media.size);
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'content-type':
			media.mimeType === 'text/html'
				? 'text/html; charset=utf-8'
				: media.mimeType === 'text/csv' && !download
					? 'text/plain; charset=utf-8'
					: media.mimeType,
		'content-disposition': safeDisposition(media.name, download),
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; media-src 'self'; sandbox"
	});
	if (media.mimeType === 'image/svg+xml') {
		headers.set('content-security-policy', svgContentSecurityPolicy);
		headers.set('cross-origin-resource-policy', 'same-origin');
		headers.set('referrer-policy', 'no-referrer');
		headers.set('x-frame-options', 'DENY');
	}
	if (media.mimeType === 'text/html') {
		headers.set('content-security-policy', htmlContentSecurityPolicy);
		headers.set('cache-control', 'private, no-store');
		headers.set('referrer-policy', 'no-referrer');
	}
	if (range === false) {
		headers.set('content-range', `bytes */${media.size}`);
		closeSessionMedia(media);
		return new Response(null, { status: 416, headers });
	}
	const [start, end] = range ?? [0, Math.max(0, media.size - 1)];
	headers.set('content-length', String(media.size ? end - start + 1 : 0));
	if (range) headers.set('content-range', `bytes ${start}-${end}/${media.size}`);
	if (head || media.size === 0) closeSessionMedia(media);
	const body: BodyInit | null =
		head || media.size === 0
			? null
			: (Readable.toWeb(
					createReadStream(media.path, {
						fd: media.descriptor,
						autoClose: true,
						start,
						end
					})
				) as unknown as BodyInit);
	return new Response(body, {
		status: range ? 206 : 200,
		headers
	});
}
