import {
	chmodSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
type Provenance = 'custom' | 'bundled' | 'hub';

export function hermesSkillsRoot(profile: string, home = homedir()) {
	return profile === 'default'
		? join(home, '.hermes', 'skills')
		: join(home, '.hermes', 'profiles', profile, 'skills');
}

function declaredName(content: string, directory: string) {
	return (
		content.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1].trim() ??
		basename(directory)
	);
}

function ownership(root: string, file: string, name: string): Provenance {
	try {
		const lock = JSON.parse(readFileSync(join(root, '.hub', 'lock.json'), 'utf8')) as {
			installed?: Record<string, { install_path?: unknown }>;
		};
		for (const [installedName, entry] of Object.entries(lock.installed ?? {})) {
			if (installedName === name) return 'hub';
			if (typeof entry.install_path !== 'string') continue;
			const installPath = realpathSync(join(root, entry.install_path));
			if (file.startsWith(`${installPath}${sep}`)) return 'hub';
		}
	} catch {
		// Missing or malformed hub lock means no hub ownership declarations.
	}
	try {
		const bundled = new Set(
			readFileSync(join(root, '.bundled_manifest'), 'utf8')
				.split('\n')
				.map((line) => line.split(':', 1)[0].trim())
				.filter(Boolean)
		);
		if (bundled.has(name)) return 'bundled';
	} catch {
		// Missing manifest means no bundled ownership declarations.
	}
	return 'custom';
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
				const content = readFileSync(path, 'utf8');
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
		content: readFileSync(found.file, 'utf8'),
		provenance: found.provenance,
		editable: found.provenance === 'custom'
	};
}

export function writeHermesSkill(
	name: string,
	content: string,
	root = hermesSkillsRoot('default')
) {
	if (!content || content.length > 1_000_000 || content.includes('\0')) {
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
