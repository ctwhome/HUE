import { randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';

type TerminalChunk = { sequence: number; data: string; bytes: number };
type TerminalSession = {
	id: string;
	projectId: string;
	terminal: Bun.Terminal;
	process: ReturnType<typeof Bun.spawn>;
	decoder: TextDecoder;
	chunks: TerminalChunk[];
	sequence: number;
	inputSequence: number;
	retainedBytes: number;
	status: 'running' | 'exited';
	exitCode: number | null;
	lastActivity: number;
};

const MAX_SESSIONS = 12;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_INPUT_CHARS = 64 * 1024;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function resolveTerminalShell(
	preferred = process.env.SHELL,
	fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh']
): string {
	for (const shell of [preferred, ...fallbacks]) {
		if (!shell) continue;
		try {
			accessSync(shell, constants.X_OK);
			return shell;
		} catch {
			// Try next known shell.
		}
	}
	throw new Error('No usable shell found. Set SHELL to an executable shell path and retry.');
}

function validateTerminalCwd(cwd: string): void {
	try {
		if (statSync(cwd).isDirectory()) return;
	} catch {
		// Report one stable recovery action below.
	}
	throw new Error(
		'Project folder is unavailable. Locate or remove the Project before opening a terminal.'
	);
}

export class ProjectTerminals {
	private sessions = new Map<string, TerminalSession>();
	private idleSweep: ReturnType<typeof setInterval>;
	private shell: string;

	constructor(options: { shell?: string } = {}) {
		this.shell = resolveTerminalShell(options.shell);
		this.idleSweep = setInterval(() => this.expireIdle(), 5 * 60 * 1000);
		this.idleSweep.unref();
	}

	create(projectId: string, cwd: string, cols: number, rows: number) {
		if (this.sessions.size >= MAX_SESSIONS) throw new Error('Maximum terminal sessions reached');
		this.validateSize(cols, rows);
		validateTerminalCwd(cwd);
		const id = randomUUID();
		const decoder = new TextDecoder();
		let session: TerminalSession;
		const terminal = new Bun.Terminal({
			cols,
			rows,
			name: 'xterm-256color',
			data: (_terminal, data) => this.append(session, decoder.decode(data, { stream: true }))
		});
		const env = Object.fromEntries(
			['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'].flatMap((name) =>
				process.env[name] ? [[name, process.env[name] as string]] : []
			)
		);
		let processHandle: ReturnType<typeof Bun.spawn>;
		try {
			processHandle = Bun.spawn([this.shell], {
				cwd,
				env: { ...env, SHELL: this.shell, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
				terminal
			});
		} catch {
			terminal.close();
			throw new Error('Terminal could not start. Check Project folder and SHELL, then retry.');
		}
		session = {
			id,
			projectId,
			terminal,
			process: processHandle,
			decoder,
			chunks: [],
			sequence: 0,
			inputSequence: 0,
			retainedBytes: 0,
			status: 'running',
			exitCode: null,
			lastActivity: Date.now()
		};
		this.sessions.set(id, session);
		void processHandle.exited.then((exitCode) => {
			session.status = 'exited';
			session.exitCode = exitCode;
			session.lastActivity = Date.now();
		});
		return { terminalId: id, cursor: 0, status: session.status };
	}

	write(projectId: string, terminalId: string, sequence: number, data: string) {
		const session = this.session(projectId, terminalId);
		if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Invalid input sequence');
		if (!data || data.length > MAX_INPUT_CHARS) throw new Error('Invalid terminal input');
		if (sequence <= session.inputSequence) return;
		if (sequence !== session.inputSequence + 1) throw new Error('Unexpected input sequence');
		if (session.status !== 'running') throw new Error('Terminal has exited');
		session.inputSequence = sequence;
		session.lastActivity = Date.now();
		session.terminal.write(data);
	}

	resize(projectId: string, terminalId: string, cols: number, rows: number) {
		this.validateSize(cols, rows);
		const session = this.session(projectId, terminalId);
		session.terminal.resize(cols, rows);
		session.lastActivity = Date.now();
	}

	read(projectId: string, terminalId: string, after: number) {
		const session = this.session(projectId, terminalId);
		const first = session.chunks[0]?.sequence ?? session.sequence + 1;
		const reset = after < first - 1;
		const output = session.chunks
			.filter((chunk) => reset || chunk.sequence > after)
			.map((chunk) => chunk.data)
			.join('');
		session.lastActivity = Date.now();
		return {
			output,
			cursor: session.sequence,
			inputSequence: session.inputSequence,
			reset,
			status: session.status,
			exitCode: session.exitCode
		};
	}

	close(projectId: string, terminalId: string) {
		const session = this.sessions.get(terminalId);
		if (!session) return;
		if (session.projectId !== projectId) throw new Error('Terminal not found');
		this.sessions.delete(terminalId);
		this.terminate(session);
	}

	closeProject(projectId: string) {
		for (const [terminalId, session] of this.sessions) {
			if (session.projectId !== projectId) continue;
			this.sessions.delete(terminalId);
			this.terminate(session);
		}
	}

	dispose() {
		clearInterval(this.idleSweep);
		for (const session of this.sessions.values()) this.terminate(session);
		this.sessions.clear();
	}

	private append(session: TerminalSession | undefined, data: string) {
		if (!session || !data) return;
		const bytes = Buffer.byteLength(data);
		session.sequence += 1;
		session.chunks.push({ sequence: session.sequence, data, bytes });
		session.retainedBytes += bytes;
		session.lastActivity = Date.now();
		while (session.retainedBytes > MAX_OUTPUT_BYTES && session.chunks.length > 1) {
			session.retainedBytes -= session.chunks.shift()!.bytes;
		}
	}

	private session(projectId: string, terminalId: string) {
		const session = this.sessions.get(terminalId);
		if (!session || session.projectId !== projectId) throw new Error('Terminal not found');
		return session;
	}

	private validateSize(cols: number, rows: number) {
		if (!Number.isInteger(cols) || cols < 2 || cols > 1000)
			throw new Error('Invalid terminal columns');
		if (!Number.isInteger(rows) || rows < 1 || rows > 500) throw new Error('Invalid terminal rows');
	}

	private expireIdle() {
		const threshold = Date.now() - IDLE_TIMEOUT_MS;
		for (const [id, session] of this.sessions) {
			if (session.lastActivity < threshold) {
				this.sessions.delete(id);
				this.terminate(session);
			}
		}
	}

	private terminate(session: TerminalSession) {
		try {
			if (process.platform !== 'win32') process.kill(-session.process.pid, 'SIGTERM');
		} catch {
			session.process.kill();
		}
		try {
			session.terminal.close();
		} catch {
			// Already closed.
		}
	}
}
