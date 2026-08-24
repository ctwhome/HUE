import {
	type BigIntStats,
	closeSync,
	fstatSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	writeFileSync
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';

const flags =
	process.platform === 'darwin'
		? { directory: 0x100000, nofollow: 0x100, cloexec: 0x1000000, create: 0x200, excl: 0x800 }
		: { directory: 0x10000, nofollow: 0x20000, cloexec: 0x80000, create: 0x40, excl: 0x80 };
const O_RDONLY = 0;
const O_WRONLY = 1;
const AT_REMOVEDIR = process.platform === 'darwin' ? 0x80 : 0x200;
const libcPath = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
type NativeFFI = Pick<typeof import('bun:ffi'), 'dlopen' | 'ptr' | 'CString'>;
const bunFFI = () => (Bun as unknown as { FFI: NativeFFI }).FFI;

function loadNative() {
	return bunFFI().dlopen(libcPath, {
		openat: { args: ['i32', 'ptr', 'i32', 'i32'], returns: 'i32' },
		mkdirat: { args: ['i32', 'ptr', 'i32'], returns: 'i32' },
		unlinkat: { args: ['i32', 'ptr', 'i32'], returns: 'i32' },
		renameat: {
			args: ['i32', 'ptr', 'i32', 'ptr'],
			returns: 'i32'
		},
		...(process.platform === 'darwin'
			? { renameatx_np: { args: ['i32', 'ptr', 'i32', 'ptr', 'i32'], returns: 'i32' } }
			: { renameat2: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' } }),
		fsync: { args: ['i32'], returns: 'i32' },
		fchmod: { args: ['i32', 'i32'], returns: 'i32' },
		dup: { args: ['i32'], returns: 'i32' },
		fdopendir: { args: ['i32'], returns: 'ptr' },
		readdir: { args: ['ptr'], returns: 'ptr' },
		closedir: { args: ['ptr'], returns: 'i32' }
	} as const);
}
let nativeLibrary: ReturnType<typeof loadNative> | undefined;
function native() {
	return (nativeLibrary ??= loadNative());
}

type FileStat = BigIntStats;
type FileType = 'file' | 'directory';
export type FileEntry = {
	name: string;
	path: string;
	type: FileType;
	size: number;
	mtime: string;
};
export type FileVersion = { hash: string; mtimeNs: string; size: number };
type DeleteManifestEntry = {
	path: string;
	type: FileType;
	device: string;
	inode: string;
	size: number;
	mtimeNs: string;
	ctimeNs: string;
	hash: string | null;
};
export type PreviewKind =
	'text' | 'code' | 'markdown' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';

function cstring(value: string) {
	const bytes = Buffer.from(`${value}\0`);
	return { bytes, pointer: bunFFI().ptr(bytes) };
}

type PointerArg = ReturnType<NativeFFI['ptr']>;
function callPath(
	fn: (fd: number, path: PointerArg, ...rest: number[]) => number,
	fd: number,
	path: string,
	...rest: number[]
) {
	const value = cstring(path);
	return fn(fd, value.pointer, ...rest);
}

function renameWithFlag(
	fromFd: number,
	fromPath: string,
	toFd: number,
	toPath: string,
	flag: 'exclusive' | 'exchange'
) {
	const from = cstring(fromPath);
	const to = cstring(toPath);
	const symbols = native().symbols as unknown as Record<
		string,
		(fromFd: number, from: PointerArg, toFd: number, to: PointerArg, flags: number) => number
	>;
	const result =
		process.platform === 'darwin'
			? symbols.renameatx_np(
					fromFd,
					from.pointer,
					toFd,
					to.pointer,
					flag === 'exclusive' ? 0x4 : 0x2
				)
			: symbols.renameat2(fromFd, from.pointer, toFd, to.pointer, flag === 'exclusive' ? 0x1 : 0x2);
	if (result !== 0) throw new Error('Atomic file operation failed');
}

function directoryNames(fd: number) {
	const duplicate = native().symbols.dup(fd);
	if (duplicate < 0) throw new Error('Directory read failed');
	const directory = native().symbols.fdopendir(duplicate);
	if (!directory) {
		closeSync(duplicate);
		throw new Error('Directory read failed');
	}
	const names: string[] = [];
	try {
		for (;;) {
			const entry = native().symbols.readdir(directory);
			if (!entry) break;
			const name = new (bunFFI().CString)(
				entry,
				process.platform === 'darwin' ? 21 : 19
			).toString();
			if (name !== '.' && name !== '..') names.push(name);
		}
	} finally {
		native().symbols.closedir(directory);
	}
	return names;
}

function safeParts(input: string, allowEmpty = false): string[] {
	if (
		typeof input !== 'string' ||
		input.includes('\0') ||
		input.includes('\\') ||
		isAbsolute(input)
	)
		throw new Error('Invalid Project file path');
	if (!input && allowEmpty) return [];
	const parts = input.split('/');
	if (!parts.length || parts.some((part) => !part || part === '.' || part === '..'))
		throw new Error('Invalid Project file path');
	return parts;
}

function openAt(parent: number, name: string, openFlags: number, mode = 0): number {
	const fd = callPath(native().symbols.openat, parent, name, openFlags, mode);
	if (fd < 0) throw new Error('Symbolic links are not allowed; Project file not found or unsafe');
	return fd;
}

function openRoot(root: string): number {
	if (!isAbsolute(root)) throw new Error('Project root must be absolute');
	let fd = openSync('/', O_RDONLY | flags.directory | flags.cloexec);
	try {
		for (const part of root.split('/').filter(Boolean)) {
			const next = openAt(fd, part, O_RDONLY | flags.directory | flags.nofollow | flags.cloexec);
			closeSync(fd);
			fd = next;
		}
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

function assertSafeFile(stat: FileStat) {
	if (!stat.isFile()) throw new Error('Project path is not a regular file');
	if (stat.nlink !== 1n) throw new Error('Hard-linked files are not allowed');
}

function fileVersion(fd: number, stat = fstatSync(fd, { bigint: true })): FileVersion {
	assertSafeFile(stat);
	if (stat.size > BigInt(ProjectFiles.MAX_HASH_BYTES))
		throw new Error('File exceeds managed size limit');
	const hash = createHash('sha256');
	const chunk = Buffer.allocUnsafe(64 * 1024);
	for (let offset = 0; offset < Number(stat.size);) {
		const length = readSync(
			fd,
			chunk,
			0,
			Math.min(chunk.length, Number(stat.size) - offset),
			offset
		);
		if (!length) break;
		hash.update(chunk.subarray(0, length));
		offset += length;
	}
	return { hash: hash.digest('hex'), mtimeNs: stat.mtimeNs.toString(), size: Number(stat.size) };
}

function sameVersion(left: FileVersion, right: FileVersion) {
	return left.hash === right.hash && left.mtimeNs === right.mtimeNs && left.size === right.size;
}

function fileFormat(path: string): { kind: PreviewKind; mime: string } {
	const extension = path.toLowerCase().match(/\.([^.\/]+)$/)?.[1] ?? '';
	if (extension === 'md' || extension === 'mdx') return { kind: 'markdown', mime: 'text/markdown' };
	if (
		[
			'ts',
			'tsx',
			'js',
			'jsx',
			'svelte',
			'css',
			'html',
			'json',
			'toml',
			'yaml',
			'yml',
			'sh',
			'py',
			'rs',
			'go',
			'sql'
		].includes(extension)
	)
		return { kind: 'code', mime: extension === 'json' ? 'application/json' : 'text/plain' };
	if (['txt', 'csv', 'log'].includes(extension)) return { kind: 'text', mime: 'text/plain' };
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(extension))
		return {
			kind: 'image',
			mime:
				extension === 'svg' ? 'image/svg+xml' : `image/${extension === 'jpg' ? 'jpeg' : extension}`
		};
	if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension))
		return { kind: 'audio', mime: `audio/${extension === 'mp3' ? 'mpeg' : extension}` };
	if (['mp4', 'webm', 'mov'].includes(extension))
		return { kind: 'video', mime: extension === 'mov' ? 'video/quicktime' : `video/${extension}` };
	if (extension === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
	return { kind: 'binary', mime: 'application/octet-stream' };
}

export class ProjectFiles {
	static readonly MAX_TREE_ENTRIES = 10_000;
	static readonly MAX_TREE_DEPTH = 32;
	static readonly MAX_QUERY_LENGTH = 200;
	static readonly MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
	static readonly MAX_WRITE_BYTES = 4 * 1024 * 1024;
	static readonly MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
	static readonly MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
	static readonly MAX_HASH_BYTES = 256 * 1024 * 1024;
	static readonly MAX_DELETE_ENTRIES = 10_000;
	static readonly MAX_DELETE_HASH_BYTES = 256 * 1024 * 1024;
	_testBeforeLeafOpen?: () => void;
	_testBeforeMutation?: () => void;
	_testContentClosed?: () => void;
	_testAfterDeleteManifestValidation?: (
		createAt: (path: string, content: string | Uint8Array) => void
	) => void;
	_testMoveFault?: (stage: 'validation' | 'cleanup' | 'rollback' | 'placeholder-cleanup') => void;

	readonly root: string;
	private readonly rootDevice: bigint;
	private readonly rootInode: bigint;
	constructor(root: string) {
		this.root = realpathSync(root);
		const fd = openRoot(this.root);
		try {
			const stat = fstatSync(fd, { bigint: true });
			this.rootDevice = stat.dev;
			this.rootInode = stat.ino;
		} finally {
			closeSync(fd);
		}
	}

	private openRoot() {
		const fd = openRoot(this.root);
		const stat = fstatSync(fd, { bigint: true });
		if (stat.dev !== this.rootDevice || stat.ino !== this.rootInode) {
			closeSync(fd);
			throw new Error('Project root changed');
		}
		return fd;
	}

	private parent(path: string) {
		const parts = safeParts(path);
		const leaf = parts.pop()!;
		let fd = this.openRoot();
		try {
			for (const part of parts) {
				const next = openAt(fd, part, O_RDONLY | flags.directory | flags.nofollow | flags.cloexec);
				closeSync(fd);
				fd = next;
			}
			this._testBeforeLeafOpen?.();
			return { fd, leaf };
		} catch (error) {
			closeSync(fd);
			throw error;
		}
	}

	private open(path: string, directory = false) {
		const parent = this.parent(path);
		try {
			const fd = openAt(
				parent.fd,
				parent.leaf,
				O_RDONLY | flags.nofollow | flags.cloexec | (directory ? flags.directory : 0)
			);
			return { fd, parentFd: parent.fd, leaf: parent.leaf };
		} catch (error) {
			closeSync(parent.fd);
			if (String(error).includes('unsafe'))
				throw new Error('Symbolic links are not allowed or Project file not found');
			throw error;
		}
	}

	tree(options: { maxEntries?: number; maxDepth?: number } = {}) {
		const maxEntries = Math.min(
			options.maxEntries ?? ProjectFiles.MAX_TREE_ENTRIES,
			ProjectFiles.MAX_TREE_ENTRIES
		);
		const maxDepth = Math.min(
			options.maxDepth ?? ProjectFiles.MAX_TREE_DEPTH,
			ProjectFiles.MAX_TREE_DEPTH
		);
		const entries: FileEntry[] = [];
		let truncated = false;
		const queue = [{ path: '', depth: 0 }];
		while (queue.length && entries.length < maxEntries) {
			const directory = queue.shift()!;
			const opened = directory.path
				? this.open(directory.path, true)
				: { fd: this.openRoot(), parentFd: null };
			try {
				for (const name of directoryNames(opened.fd).sort((a, b) => a.localeCompare(b))) {
					if (entries.length >= maxEntries) {
						truncated = true;
						break;
					}
					let child: number;
					try {
						child = openAt(opened.fd, name, O_RDONLY | flags.nofollow | flags.cloexec);
					} catch {
						continue;
					}
					try {
						const stat = fstatSync(child, { bigint: true });
						const type: FileType | null = stat.isDirectory()
							? 'directory'
							: stat.isFile() && stat.nlink === 1n
								? 'file'
								: null;
						if (!type) continue;
						const path = directory.path ? `${directory.path}/${name}` : name;
						entries.push({
							name,
							path,
							type,
							size: Number(stat.size),
							mtime: stat.mtime.toISOString()
						});
						if (type === 'directory') {
							if (directory.depth < maxDepth) queue.push({ path, depth: directory.depth + 1 });
							else if (directoryNames(child).length) truncated = true;
						}
					} finally {
						closeSync(child);
					}
				}
			} finally {
				closeSync(opened.fd);
				if (opened.parentFd !== null) closeSync(opened.parentFd);
			}
		}
		if (queue.length) truncated = true;
		return { entries, truncated, limits: { maxEntries, maxDepth } };
	}

	search(query: string, options: { maxResults?: number } = {}) {
		const value = query.trim();
		if (!value) return { results: [], truncated: false };
		if (value.length > ProjectFiles.MAX_QUERY_LENGTH) throw new Error('Search query is too long');
		const maxResults = Math.min(options.maxResults ?? 100, 500);
		const index = this.tree();
		const matches = index.entries.filter(({ path }) =>
			path.toLocaleLowerCase().includes(value.toLocaleLowerCase())
		);
		return {
			results: matches.slice(0, maxResults),
			truncated: index.truncated || matches.length > maxResults
		};
	}

	readBytes(path: string, maxBytes: number) {
		const opened = this.open(path);
		try {
			const stat = fstatSync(opened.fd, { bigint: true });
			assertSafeFile(stat);
			if (stat.size > BigInt(maxBytes)) throw new Error('Project file exceeds size limit');
			return readFileSync(opened.fd);
		} finally {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
		}
	}

	preview(path: string) {
		const opened = this.open(path);
		try {
			const stat = fstatSync(opened.fd, { bigint: true });
			assertSafeFile(stat);
			const version =
				stat.size <= BigInt(ProjectFiles.MAX_WRITE_BYTES) ? fileVersion(opened.fd, stat) : null;
			const format = fileFormat(path);
			const textual = ['text', 'code', 'markdown'].includes(format.kind);
			const content =
				textual && stat.size <= BigInt(ProjectFiles.MAX_PREVIEW_BYTES)
					? readFileSync(opened.fd, 'utf8')
					: null;
			return {
				path,
				name: opened.leaf,
				...format,
				size: Number(stat.size),
				mtime: stat.mtime.toISOString(),
				version,
				concurrency: version ? 'content-hash' : 'unavailable-file-exceeds-hash-limit',
				content
			};
		} finally {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
		}
	}

	metadata(path: string) {
		const opened = this.open(path);
		try {
			const stat = fstatSync(opened.fd, { bigint: true });
			assertSafeFile(stat);
			return {
				path,
				name: opened.leaf,
				...fileFormat(path),
				size: Number(stat.size),
				mtime: stat.mtime.toISOString(),
				version: null,
				concurrency:
					stat.size > BigInt(ProjectFiles.MAX_WRITE_BYTES)
						? ('unavailable-file-exceeds-hash-limit' as const)
						: ('not-requested' as const)
			};
		} finally {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
		}
	}

	validateFile(path: string) {
		const opened = this.open(path);
		try {
			assertSafeFile(fstatSync(opened.fd, { bigint: true }));
			return true;
		} finally {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
		}
	}

	content(path: string, range?: { start: number; end: number }) {
		const opened = this.open(path);
		try {
			const stat = fstatSync(opened.fd, { bigint: true });
			assertSafeFile(stat);
			const size = Number(stat.size);
			const start = range?.start ?? 0;
			const end = range?.end ?? size - 1;
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				start < 0 ||
				end < start ||
				end >= size
			)
				throw new Error('Invalid byte range');
			let offset = start;
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				closeSync(opened.fd);
				this._testContentClosed?.();
			};
			closeSync(opened.parentFd);
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (offset > end) {
						close();
						controller.close();
						return;
					}
					try {
						const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, end - offset + 1));
						const length = readSync(opened.fd, chunk, 0, chunk.byteLength, offset);
						if (!length) throw new Error('File changed while reading');
						offset += length;
						controller.enqueue(chunk.subarray(0, length));
					} catch (error) {
						close();
						controller.error(error);
					}
				},
				cancel: close
			});
			return { stream, size, length: end - start + 1, ...fileFormat(path) };
		} catch (error) {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
			throw error;
		}
	}

	save(path: string, content: string | Uint8Array, expected?: FileVersion) {
		return this.atomicSave(path, content, expected, ProjectFiles.MAX_WRITE_BYTES);
	}

	private atomicSave(
		path: string,
		content: string | Uint8Array,
		expected: FileVersion | undefined,
		limit: number
	) {
		const bytes = typeof content === 'string' ? Buffer.from(content) : content;
		if (bytes.byteLength > limit) throw new Error('File exceeds write limit');
		const parent = this.parent(path);
		let existing: number | null = null;
		let existed = false;
		let mode = 0o600;
		try {
			try {
				existing = openAt(parent.fd, parent.leaf, O_RDONLY | flags.nofollow | flags.cloexec);
				existed = true;
				const existingStat = fstatSync(existing, { bigint: true });
				const current = fileVersion(existing, existingStat);
				mode = Number(existingStat.mode & 0o777n);
				if (expected && !sameVersion(current, expected))
					throw new Error('File changed outside HUE');
				if (!expected) throw new Error('File already exists');
			} catch (error) {
				if (existing !== null || expected || !String(error).includes('not found')) throw error;
			}
			const temp = `.hue-write-${randomBytes(12).toString('hex')}`;
			const tempFd = openAt(
				parent.fd,
				temp,
				O_WRONLY | flags.create | flags.excl | flags.nofollow | flags.cloexec,
				mode
			);
			try {
				if (native().symbols.fchmod(tempFd, mode) !== 0)
					throw new Error('File permission setup failed');
				writeFileSync(tempFd, bytes);
				native().symbols.fsync(tempFd);
			} catch (error) {
				callPath(native().symbols.unlinkat, parent.fd, temp, 0);
				throw error;
			} finally {
				closeSync(tempFd);
			}
			this._testBeforeMutation?.();
			try {
				if (existed) {
					renameWithFlag(parent.fd, temp, parent.fd, parent.leaf, 'exchange');
					const replaced = openAt(parent.fd, temp, O_RDONLY | flags.nofollow | flags.cloexec);
					try {
						if (!expected || !sameVersion(fileVersion(replaced), expected)) {
							renameWithFlag(parent.fd, temp, parent.fd, parent.leaf, 'exchange');
							callPath(native().symbols.unlinkat, parent.fd, temp, 0);
							throw new Error('File changed outside HUE');
						}
					} finally {
						closeSync(replaced);
					}
					if (callPath(native().symbols.unlinkat, parent.fd, temp, 0) !== 0)
						throw new Error('Replaced file cleanup failed');
				} else renameWithFlag(parent.fd, temp, parent.fd, parent.leaf, 'exclusive');
			} catch (error) {
				callPath(native().symbols.unlinkat, parent.fd, temp, 0);
				throw error;
			}
			return this.preview(path);
		} finally {
			if (existing !== null) closeSync(existing);
			closeSync(parent.fd);
		}
	}

	upload(path: string, content: Uint8Array) {
		if (content.byteLength > ProjectFiles.MAX_UPLOAD_BYTES)
			throw new Error('Upload exceeds size limit');
		return this.atomicSave(path, content, undefined, ProjectFiles.MAX_UPLOAD_BYTES);
	}

	createDirectory(path: string) {
		const parent = this.parent(path);
		try {
			if (callPath(native().symbols.mkdirat, parent.fd, parent.leaf, 0o700) !== 0)
				throw new Error('Directory creation failed');
			const created = openAt(
				parent.fd,
				parent.leaf,
				O_RDONLY | flags.directory | flags.nofollow | flags.cloexec
			);
			try {
				if (native().symbols.fchmod(created, 0o700) !== 0)
					throw new Error('Directory permission setup failed');
			} finally {
				closeSync(created);
			}
		} finally {
			closeSync(parent.fd);
		}
	}

	deleteImpact(path: string) {
		const opened = this.open(path);
		let files = 0;
		let directories = 0;
		let bytes = 0;
		let hashedBytes = 0;
		const manifest: DeleteManifestEntry[] = [];
		const inspect = (fd: number, relativePath: string) => {
			if (manifest.length >= ProjectFiles.MAX_DELETE_ENTRIES)
				throw new Error('Delete impact exceeds manifest entry limit');
			const stat = fstatSync(fd, { bigint: true });
			if (stat.isFile()) {
				assertSafeFile(stat);
				if (hashedBytes + Number(stat.size) > ProjectFiles.MAX_DELETE_HASH_BYTES)
					throw new Error('Delete impact exceeds manifest hash limit');
				files += 1;
				bytes += Number(stat.size);
				hashedBytes += Number(stat.size);
				manifest.push({
					path: relativePath,
					type: 'file',
					device: stat.dev.toString(),
					inode: stat.ino.toString(),
					size: Number(stat.size),
					mtimeNs: stat.mtimeNs.toString(),
					ctimeNs: stat.ctimeNs.toString(),
					hash: fileVersion(fd, stat).hash
				});
				return;
			}
			if (!stat.isDirectory()) throw new Error('Unsupported file type');
			directories += 1;
			manifest.push({
				path: relativePath,
				type: 'directory',
				device: stat.dev.toString(),
				inode: stat.ino.toString(),
				size: Number(stat.size),
				mtimeNs: stat.mtimeNs.toString(),
				ctimeNs: stat.ctimeNs.toString(),
				hash: null
			});
			for (const name of directoryNames(fd).sort()) {
				const child = openAt(fd, name, O_RDONLY | flags.nofollow | flags.cloexec);
				try {
					inspect(child, relativePath ? `${relativePath}/${name}` : name);
				} finally {
					closeSync(child);
				}
			}
		};
		try {
			inspect(opened.fd, '');
		} finally {
			closeSync(opened.fd);
			closeSync(opened.parentFd);
		}
		manifest.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
		const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
		const confirmation = `delete ${path} (${files} files, ${directories} directories, ${bytes} bytes, manifest ${manifestHash})`;
		return { path, files, directories, bytes, manifest, manifestHash, confirmation };
	}

	remove(path: string, confirmation: string) {
		const impact = this.deleteImpact(path);
		if (confirmation !== impact.confirmation) throw new Error('Delete confirmation does not match');
		const parent = this.parent(path);
		const quarantine = `.hue-delete-${randomBytes(12).toString('hex')}`;
		let directory = false;
		const removePlaceholder = (name: string) =>
			callPath(native().symbols.unlinkat, parent.fd, name, directory ? AT_REMOVEDIR : 0) === 0;
		try {
			const selected = openAt(parent.fd, parent.leaf, O_RDONLY | flags.nofollow | flags.cloexec);
			try {
				const stat = fstatSync(selected, { bigint: true });
				if (stat.isFile()) assertSafeFile(stat);
				else if (!stat.isDirectory()) throw new Error('Unsupported file type');
				directory = stat.isDirectory();
			} finally {
				closeSync(selected);
			}
			if (directory) {
				if (callPath(native().symbols.mkdirat, parent.fd, quarantine, 0o700) !== 0)
					throw new Error('Delete quarantine creation failed');
			} else {
				const placeholder = openAt(
					parent.fd,
					quarantine,
					O_WRONLY | flags.create | flags.excl | flags.nofollow | flags.cloexec,
					0o600
				);
				closeSync(placeholder);
			}
			this._testBeforeMutation?.();
			if (this.deleteImpact(path).manifestHash !== impact.manifestHash) {
				removePlaceholder(quarantine);
				throw new Error('Delete confirmation does not match current manifest');
			}
			renameWithFlag(parent.fd, parent.leaf, parent.fd, quarantine, 'exchange');
			const bound = new Map<
				string,
				{ fd: number; parentFd: number; name: string; entry: DeleteManifestEntry }
			>();
			try {
				for (const entry of [...impact.manifest].sort(
					(left, right) =>
						(left.path ? left.path.split('/').length : 0) -
						(right.path ? right.path.split('/').length : 0)
				)) {
					const parts = entry.path ? entry.path.split('/') : [];
					const name = parts.pop() ?? quarantine;
					const parentPath = parts.join('/');
					const parentFd = entry.path ? bound.get(parentPath)?.fd : parent.fd;
					if (parentFd === undefined) throw new Error('Delete manifest parent changed');
					const fd = openAt(
						parentFd,
						name,
						O_RDONLY |
							flags.nofollow |
							flags.cloexec |
							(entry.type === 'directory' ? flags.directory : 0)
					);
					const stat = fstatSync(fd, { bigint: true });
					const matches =
						(entry.type === 'file' ? stat.isFile() && stat.nlink === 1n : stat.isDirectory()) &&
						stat.dev.toString() === entry.device &&
						stat.ino.toString() === entry.inode &&
						Number(stat.size) === entry.size &&
						stat.mtimeNs.toString() === entry.mtimeNs &&
						(entry.path === '' || stat.ctimeNs.toString() === entry.ctimeNs) &&
						(entry.type === 'directory' || fileVersion(fd, stat).hash === entry.hash);
					if (!matches) {
						closeSync(fd);
						throw new Error('Delete manifest entry changed');
					}
					bound.set(entry.path, { fd, parentFd, name, entry });
				}
				for (const current of bound.values()) {
					if (current.entry.type !== 'directory') continue;
					const expectedNames = impact.manifest
						.filter((entry) => {
							const parts = entry.path.split('/');
							parts.pop();
							return entry.path !== '' && parts.join('/') === current.entry.path;
						})
						.map((entry) => entry.path.split('/').at(-1)!)
						.sort();
					if (JSON.stringify(directoryNames(current.fd).sort()) !== JSON.stringify(expectedNames))
						throw new Error('Delete manifest directory changed');
				}
				this._testAfterDeleteManifestValidation?.((relativePath, content) => {
					const parts = safeParts(relativePath);
					const name = parts.pop()!;
					const directoryFd = bound.get(parts.join('/'))?.fd;
					if (directoryFd === undefined) throw new Error('Test directory is not bound');
					const fd = openAt(
						directoryFd,
						name,
						O_WRONLY | flags.create | flags.excl | flags.nofollow | flags.cloexec,
						0o600
					);
					try {
						if (native().symbols.fchmod(fd, 0o600) !== 0)
							throw new Error('Test file permission setup failed');
						writeFileSync(fd, content);
					} finally {
						closeSync(fd);
					}
				});
				for (const current of [...bound.values()].sort(
					(left, right) =>
						(right.entry.path ? right.entry.path.split('/').length : 0) -
						(left.entry.path ? left.entry.path.split('/').length : 0)
				)) {
					const present = openAt(
						current.parentFd,
						current.name,
						O_RDONLY |
							flags.nofollow |
							flags.cloexec |
							(current.entry.type === 'directory' ? flags.directory : 0)
					);
					const presentStat = fstatSync(present, { bigint: true });
					const boundStat = fstatSync(current.fd, { bigint: true });
					closeSync(present);
					if (presentStat.dev !== boundStat.dev || presentStat.ino !== boundStat.ino)
						throw new Error('Delete manifest entry changed');
					if (
						callPath(
							native().symbols.unlinkat,
							current.parentFd,
							current.name,
							current.entry.type === 'directory' ? AT_REMOVEDIR : 0
						) !== 0
					)
						throw new Error('Delete failed because file changed');
				}
			} catch (error) {
				for (const current of bound.values()) closeSync(current.fd);
				try {
					renameWithFlag(parent.fd, parent.leaf, parent.fd, quarantine, 'exchange');
				} catch {
					throw new Error('Delete rollback failed; quarantined content retained');
				}
				if (!removePlaceholder(quarantine))
					throw new Error('Delete content restored; quarantine placeholder cleanup failed');
				throw new Error(`Delete failed because file changed; quarantined content restored`, {
					cause: error
				});
			}
			for (const current of bound.values()) closeSync(current.fd);
			if (!removePlaceholder(parent.leaf))
				throw new Error('Delete completed; placeholder cleanup failed');
		} finally {
			closeSync(parent.fd);
		}
	}

	move(fromPath: string, toPath: string, expected: FileVersion) {
		const source = this.open(fromPath);
		try {
			const stat = fstatSync(source.fd, { bigint: true });
			assertSafeFile(stat);
			if (!sameVersion(fileVersion(source.fd, stat), expected))
				throw new Error('File changed outside HUE');
			const target = this.parent(toPath);
			try {
				try {
					const existing = openAt(
						target.fd,
						target.leaf,
						O_RDONLY | flags.nofollow | flags.cloexec
					);
					closeSync(existing);
					throw new Error('Destination already exists');
				} catch (error) {
					if (!String(error).includes('not found')) throw error;
				}
				const placeholder = openAt(
					target.fd,
					target.leaf,
					O_WRONLY | flags.create | flags.excl | flags.nofollow | flags.cloexec,
					0o600
				);
				closeSync(placeholder);
				this._testBeforeMutation?.();
				let exchanged = false;
				let validated = false;
				try {
					renameWithFlag(source.parentFd, source.leaf, target.fd, target.leaf, 'exchange');
					exchanged = true;
					this._testMoveFault?.('validation');
					const moved = openAt(target.fd, target.leaf, O_RDONLY | flags.nofollow | flags.cloexec);
					try {
						if (!sameVersion(fileVersion(moved), expected))
							throw new Error('File changed outside HUE');
					} finally {
						closeSync(moved);
					}
					validated = true;
					this._testMoveFault?.('cleanup');
					if (callPath(native().symbols.unlinkat, source.parentFd, source.leaf, 0) !== 0)
						throw new Error('Move cleanup failed');
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!exchanged) {
						callPath(native().symbols.unlinkat, target.fd, target.leaf, 0);
						throw error;
					}
					if (validated) {
						if (callPath(native().symbols.unlinkat, source.parentFd, source.leaf, 0) === 0) return;
						throw new Error(
							`Move completed; original retained at destination; source placeholder cleanup failed after ${message}`
						);
					}
					try {
						this._testMoveFault?.('rollback');
						renameWithFlag(source.parentFd, source.leaf, target.fd, target.leaf, 'exchange');
					} catch {
						throw new Error(
							`Move rollback failed; original retained at destination after ${message}`
						);
					}
					try {
						this._testMoveFault?.('placeholder-cleanup');
					} catch {
						throw new Error(
							`Move rolled back; original restored at source; destination placeholder cleanup failed after ${message}`
						);
					}
					if (callPath(native().symbols.unlinkat, target.fd, target.leaf, 0) !== 0)
						throw new Error(
							`Move rolled back; original restored at source; destination placeholder cleanup failed after ${message}`
						);
					throw new Error(`Move rolled back after ${message}`, { cause: error });
				}
			} finally {
				closeSync(target.fd);
			}
		} finally {
			closeSync(source.fd);
			closeSync(source.parentFd);
		}
	}

	artifacts() {
		return this.tree()
			.entries.filter(({ type }) => type === 'file')
			.map((entry) => {
				const lower = entry.path.toLowerCase();
				const classification =
					/(^|\/)(verification|test-results?|evidence)[^/]*\.(json|md|txt)$/.test(lower)
						? 'verification'
						: /\.(diff|patch)$/.test(lower)
							? 'diff'
							: /(screenshot|screen-shot)[^/]*\.(png|jpe?g|webp)$/.test(lower)
								? 'screenshot'
								: /(recording|capture)[^/]*\.(mp4|webm|mov|mp3|wav|m4a)$/.test(lower)
									? 'recording'
									: /(^|\/)(build|dist|generated|output)(\/|$)/.test(lower)
										? 'generated'
										: 'source';
				return {
					...entry,
					classification,
					verified: false,
					provenance: 'Filename heuristic; contents not independently verified'
				};
			});
	}
}
