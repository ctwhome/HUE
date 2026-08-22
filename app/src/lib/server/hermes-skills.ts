import {
	chmodSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function declaredName(content: string, directory: string): string {
	return content.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1].trim() ?? basename(directory);
}

function findSkillFile(root: string, name: string): string {
	if (!VALID_NAME.test(name)) throw new Error('Invalid skill name');
	const canonicalRoot = realpathSync(root);
	const visit = (directory: string): string | null => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				const found = visit(path);
				if (found) return found;
			} else if (entry.isFile() && entry.name === 'SKILL.md') {
				const content = readFileSync(path, 'utf8');
				if (declaredName(content.slice(0, 16_384), directory) === name) {
					const canonical = realpathSync(path);
					if (!canonical.startsWith(`${canonicalRoot}${sep}`)) throw new Error('Skill path escaped root');
					return canonical;
				}
			}
		}
		return null;
	};
	const file = visit(canonicalRoot);
	if (!file) throw new Error(`Hermes skill ${name} was not found`);
	return file;
}

export function readHermesSkill(name: string, root = join(homedir(), '.hermes', 'skills')) {
	return { name, content: readFileSync(findSkillFile(root, name), 'utf8') };
}

export function writeHermesSkill(
	name: string,
	content: string,
	root = join(homedir(), '.hermes', 'skills')
) {
	if (!content || content.length > 1_000_000 || content.includes('\0')) {
		throw new Error('Skill content must be between 1 byte and 1 MB');
	}
	if (declaredName(content, name) !== name) throw new Error(`Skill name must remain ${name}`);
	const file = findSkillFile(root, name);
	const temporary = join(dirname(file), `.SKILL.md.${crypto.randomUUID()}.tmp`);
	writeFileSync(temporary, content, 'utf8');
	chmodSync(temporary, statSync(file).mode);
	renameSync(temporary, file);
	return { name, content };
}
