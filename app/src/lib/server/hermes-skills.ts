import {
	chmodSync,
	closeSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_CONTENT_BYTES = 1_000_000;
type Provenance = 'custom' | 'bundled' | 'hub';

export function hermesSkillsRoot(profile: string, env: NodeJS.ProcessEnv = process.env) {
	const home = env.HERMES_HOME ?? join(env.HOME ?? '', '.hermes');
	return profile === 'default' ? join(home, 'skills') : join(home, 'profiles', profile, 'skills');
}

function declaredName(content: string, directory: string) {
	return (
		content.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1].trim() ??
		basename(directory)
	);
}

function ownership(root: string, file: string, name: string): Provenance {
	const optional = (path: string) => {
		try {
			return readFileSync(path, 'utf8');
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw new Error('Skill ownership could not be verified');
		}
	};
	try {
		const content = optional(join(root, '.hub', 'lock.json'));
		const lock = (content === null ? null : JSON.parse(content)) as {
			installed?: Record<string, { install_path?: unknown }>;
		} | null;
		if (
			lock &&
			(typeof lock !== 'object' || !lock.installed || typeof lock.installed !== 'object')
		) {
			throw new Error('invalid hub lock');
		}
		for (const [installedName, entry] of Object.entries(lock?.installed ?? {})) {
			if (installedName === name) return 'hub';
			if (!entry || typeof entry !== 'object' || typeof entry.install_path !== 'string') {
				throw new Error('invalid hub lock');
			}
			const installPath = realpathSync(join(root, entry.install_path));
			if (file.startsWith(`${installPath}${sep}`)) return 'hub';
		}
	} catch {
		throw new Error('Skill ownership could not be verified');
	}
	try {
		const content = optional(join(root, '.bundled_manifest'));
		const bundled = new Set(
			(content ?? '')
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => {
					if (!line.includes(':')) throw new Error('invalid bundled manifest');
					return line.split(':', 1)[0].trim();
				})
		);
		if (bundled.has(name)) return 'bundled';
	} catch {
		throw new Error('Skill ownership could not be verified');
	}
	return 'custom';
}

function boundedContent(file: string): string {
	const size = statSync(file).size;
	if (size > MAX_CONTENT_BYTES) throw new Error('Skill content exceeds 1 MB');
	const descriptor = openSync(file, 'r');
	try {
		const buffer = Buffer.alloc(size);
		readSync(descriptor, buffer, 0, size, 0);
		return buffer.toString('utf8');
	} finally {
		closeSync(descriptor);
	}
}

function findSkill(root: string, name: string) {
	if (!VALID_NAME.test(name)) throw new Error('Invalid skill name');
	let canonicalRoot: string;
	try {
		canonicalRoot = realpathSync(root);
	} catch {
		throw new Error(`Hermes skill ${name} was not found`);
	}
	const visit = (directory: string): string | null => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				const found = visit(path);
				if (found) return found;
			} else if (entry.isFile() && entry.name === 'SKILL.md') {
				const content = boundedContent(path);
				if (declaredName(content.slice(0, 16_384), directory) !== name) continue;
				const canonical = realpathSync(path);
				if (!canonical.startsWith(`${canonicalRoot}${sep}`))
					throw new Error('Skill path escaped root');
				return canonical;
			}
		}
		return null;
	};
	const file = visit(canonicalRoot);
	if (!file) throw new Error(`Hermes skill ${name} was not found`);
	return { file, provenance: ownership(canonicalRoot, file, name) };
}

export function readHermesSkill(name: string, root = hermesSkillsRoot('default')) {
	const found = findSkill(root, name);
	return {
		name,
		content: boundedContent(found.file),
		provenance: found.provenance,
		editable: found.provenance === 'custom'
	};
}

export function writeHermesSkill(
	name: string,
	content: string,
	root = hermesSkillsRoot('default')
) {
	if (
		!content ||
		Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES ||
		content.includes('\0')
	) {
		throw new Error('Skill content must be between 1 byte and 1 MB');
	}
	if (declaredName(content, name) !== name) throw new Error(`Skill name must remain ${name}`);
	const found = findSkill(root, name);
	if (found.provenance !== 'custom') throw new Error(`${found.provenance} skills are read-only`);
	const temporary = join(dirname(found.file), `.SKILL.md.${crypto.randomUUID()}.tmp`);
	writeFileSync(temporary, content, 'utf8');
	chmodSync(temporary, statSync(found.file).mode);
	renameSync(temporary, found.file);
	return readHermesSkill(name, root);
}

export function deleteHermesSkill(name: string, root = hermesSkillsRoot('default')) {
	const found = findSkill(root, name);
	if (found.provenance !== 'custom') throw new Error(`${found.provenance} skills are read-only`);
	const canonicalRoot = realpathSync(root);
	const directory = realpathSync(dirname(found.file));
	const child = relative(canonicalRoot, directory);
	if (!child || child.startsWith(`..${sep}`) || child === '..')
		throw new Error('Skill path escaped root');
	rmSync(directory, { recursive: true });
	return { name, deleted: true };
}
