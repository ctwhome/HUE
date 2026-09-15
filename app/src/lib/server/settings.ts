import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultSettings, validateSettings, type SettingsSnapshot } from '../settings';

export class SettingsFile {
	constructor(readonly path = join(homedir(), '.hue', 'settings.json')) {}

	raw(): { text: string; revision: string; path: string } {
		let text: string;
		try {
			const stat = lstatSync(this.path);
			if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Settings must be a regular file');
			if (stat.size > 10 * 1024 * 1024) throw new Error('Settings exceed 10 MB');
			text = readFileSync(this.path, 'utf8');
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
			mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
			text = JSON.stringify(defaultSettings(), null, 2) + '\n';
			try { writeFileSync(this.path, text, { flag: 'wx', mode: 0o600 }); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.raw(); throw error; }
		}
		return { text, revision: createHash('sha256').update(text).digest('hex'), path: this.path };
	}

	read(): SettingsSnapshot {
		const { text, ...metadata } = this.raw();
		return { ...metadata, settings: validateSettings(JSON.parse(text)) };
	}

	save(value: unknown, expected: string): SettingsSnapshot {
		const settings = validateSettings(value);
		const text = JSON.stringify(settings, null, 2) + '\n';
		if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('Settings exceed 10 MB');
		if (this.raw().revision !== expected) throw new Error('Settings changed outside this editor. Reload before saving.');
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
			if (this.raw().revision !== expected) throw new Error('Settings changed outside this editor. Reload before saving.');
			renameSync(temporary, this.path);
		} finally { rmSync(temporary, { force: true }); }
		return this.read();
	}
}

export const settingsFile = new SettingsFile(
	process.env.HUE_DATABASE_PATH && process.env.HUE_DATABASE_PATH !== ':memory:'
		? join(dirname(process.env.HUE_DATABASE_PATH), 'settings.json')
		: undefined
);
