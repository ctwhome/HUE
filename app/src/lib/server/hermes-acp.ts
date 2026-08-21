import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { DeliveryUncertainError, type PromptRuntime } from './message-dispatcher';
import type { ImageAttachment } from '$lib/message-content';

export type HermesSession = {
	sessionId: string;
	cwd: string;
	title?: string | null;
	updatedAt?: string | null;
};

export type HermesTranscriptMessage = {
	role: 'user' | 'assistant';
	text: string;
};

type HermesACPOptions = {
	command?: string;
	profile?: string;
	onDiagnostic?: (message: string) => void;
};

export class HermesACP implements PromptRuntime {
	private readonly command: string;
	private readonly profile: string;
	private readonly onDiagnostic?: (message: string) => void;
	private child: ChildProcessWithoutNullStreams | null = null;
	private connection: acp.ClientConnection | null = null;
	private starting: Promise<void> | null = null;
	private closing = false;
	private readonly updateHandlers = new Map<string, Set<(update: acp.SessionUpdate) => void>>();
	private readonly availableCommands = new Map<string, acp.AvailableCommand[]>();
	private readonly commandWaiters = new Map<string, Set<() => void>>();

	constructor(options: HermesACPOptions = {}) {
		this.command = options.command ?? 'hermes';
		this.profile = options.profile ?? 'default';
		this.onDiagnostic = options.onDiagnostic;
	}

	async start(): Promise<void> {
		if (this.connection && !this.connection.signal.aborted) return;
		if (this.starting) return this.starting;
		this.closing = false;
		this.starting = this.open();
		try {
			await this.starting;
		} finally {
			this.starting = null;
		}
	}

	private async open(): Promise<void> {
		const args = this.profile === 'default' ? ['acp'] : ['--profile', this.profile, 'acp'];
		const child = spawn(this.command, args, {
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe']
		}) as ChildProcessWithoutNullStreams;
		this.child = child;

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			const diagnostic = chunk.trim();
			if (diagnostic) this.onDiagnostic?.(diagnostic);
		});
		child.once('error', (error) => {
			this.onDiagnostic?.(`Hermes ACP process error: ${error.message}`);
		});

		const stream = acp.ndJsonStream(
			Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
		);
		const app = acp
			.client({ name: 'hue-workspace' })
			.onRequest(acp.methods.client.session.requestPermission, () => ({
				outcome: { outcome: 'cancelled' }
			}))
			.onNotification(acp.methods.client.session.update, ({ params }) => {
				this.dispatchUpdate(params.sessionId, params.update);
			});
		const connection = app.connect(stream);
		this.connection = connection;

		child.once('exit', (code, signal) => {
			if (this.child === child) this.child = null;
			if (this.connection === connection) this.connection = null;
			if (!this.closing) {
				const reason = `Hermes ACP exited unexpectedly (code=${String(code)}, signal=${String(signal)})`;
				this.onDiagnostic?.(reason);
				connection.close(new Error(reason));
			}
		});

		try {
			const initialized = await connection.agent.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
				clientInfo: { name: 'hue-workspace', version: '0.1.0' }
			});
			if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
				throw new Error(
					`Hermes negotiated ACP v${initialized.protocolVersion}; HUE requires v${acp.PROTOCOL_VERSION}`
				);
			}
		} catch (error) {
			connection.close(error);
			child.kill('SIGTERM');
			this.connection = null;
			this.child = null;
			throw error;
		}
	}

	private async context(): Promise<acp.ClientContext> {
		await this.start();
		if (!this.connection) throw new Error('Hermes ACP did not start');
		return this.connection.agent;
	}

	async createSession(cwd: string): Promise<HermesSession> {
		const context = await this.context();
		const response = await context.request(acp.methods.agent.session.new, {
			cwd,
			mcpServers: []
		});
		return { sessionId: response.sessionId, cwd };
	}

	async listSessions(cwd: string): Promise<HermesSession[]> {
		const context = await this.context();
		const sessions: acp.SessionInfo[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		do {
			const response = (await context.request(acp.methods.agent.session.list, {
				cwd,
				...(cursor ? { cursor } : {})
			})) as acp.ListSessionsResponse;
			sessions.push(...response.sessions);
			const next = response.nextCursor ?? undefined;
			if (next && seenCursors.has(next))
				throw new Error('Hermes returned a repeated Session cursor');
			if (next) seenCursors.add(next);
			cursor = next;
		} while (cursor);

		return sessions.map((session) => ({
			sessionId: session.sessionId,
			cwd: session.cwd,
			title: session.title,
			updatedAt: session.updatedAt
		}));
	}

	async resumeSession(
		cwd: string,
		sessionId: string,
		onChunk?: (text: string) => void
	): Promise<void> {
		const context = await this.context();
		const unsubscribe = this.setTextHandler(sessionId, onChunk);
		try {
			const response = await context.request(acp.methods.agent.session.load, {
				cwd,
				sessionId,
				mcpServers: []
			});
			if (!response) throw new Error(`Hermes Session ${sessionId} was not found`);
		} finally {
			unsubscribe();
		}
	}

	async loadTranscript(cwd: string, sessionId: string): Promise<HermesTranscriptMessage[]> {
		const context = await this.context();
		const transcript: HermesTranscriptMessage[] = [];
		const unsubscribe = this.subscribe(sessionId, (update) => {
			if (update.sessionUpdate === 'user_message_chunk' && update.content.type === 'text') {
				transcript.push({ role: 'user', text: update.content.text });
			}
			if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
				transcript.push({ role: 'assistant', text: update.content.text });
			}
		});
		try {
			const response = await context.request(acp.methods.agent.session.load, {
				cwd,
				sessionId,
				mcpServers: []
			});
			if (!response) throw new Error(`Hermes Session ${sessionId} was not found`);
			await this.waitForAvailableCommands(sessionId);
			return transcript;
		} finally {
			unsubscribe();
		}
	}

	async prompt(input: {
		sessionId: string;
		text: string;
		images: ImageAttachment[];
		onChunk: (text: string) => void;
	}): Promise<void> {
		const context = await this.context();
		const unsubscribe = this.setTextHandler(input.sessionId, input.onChunk);
		try {
			const response = await context.request(acp.methods.agent.session.prompt, {
				sessionId: input.sessionId,
				prompt: [
					...(input.text.trim() ? [{ type: 'text' as const, text: input.text }] : []),
					...input.images.map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType }))
				]
			});
			if (response.stopReason !== 'end_turn') {
				throw new Error(`Hermes ended the turn with ${response.stopReason}`);
			}
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Hermes ended the turn with ')) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new DeliveryUncertainError(`ACP disconnected before acknowledgement: ${message}`);
		} finally {
			unsubscribe();
		}
	}

	private setTextHandler(sessionId: string, onChunk?: (text: string) => void): () => void {
		if (!onChunk) return () => {};
		return this.subscribe(sessionId, (update) => {
			if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
				onChunk(update.content.text);
			}
		});
	}

	private subscribe(sessionId: string, handler: (update: acp.SessionUpdate) => void): () => void {
		const handlers = this.updateHandlers.get(sessionId) ?? new Set();
		handlers.add(handler);
		this.updateHandlers.set(sessionId, handlers);
		return () => {
			handlers.delete(handler);
			if (!handlers.size) this.updateHandlers.delete(sessionId);
		};
	}

	private dispatchUpdate(sessionId: string, update: acp.SessionUpdate): void {
		if (update.sessionUpdate === 'available_commands_update') {
			this.availableCommands.set(sessionId, update.availableCommands);
			for (const resolve of this.commandWaiters.get(sessionId) ?? []) resolve();
			this.commandWaiters.delete(sessionId);
		}
		for (const handler of this.updateHandlers.get(sessionId) ?? []) handler(update);
	}

	getAvailableCommands(sessionId: string): acp.AvailableCommand[] {
		return this.availableCommands.get(sessionId) ?? [];
	}

	private async waitForAvailableCommands(sessionId: string): Promise<void> {
		if (this.availableCommands.has(sessionId)) return;
		await new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(finish, 250);
			const waiters = this.commandWaiters.get(sessionId) ?? new Set();
			waiters.add(finish);
			this.commandWaiters.set(sessionId, waiters);
		});
	}

	async close(): Promise<void> {
		this.closing = true;
		const connection = this.connection;
		const child = this.child;
		this.connection = null;
		this.child = null;
		this.updateHandlers.clear();
		this.availableCommands.clear();
		for (const waiters of this.commandWaiters.values()) for (const resolve of waiters) resolve();
		this.commandWaiters.clear();
		connection?.close();
		if (!child || child.exitCode !== null) return;

		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				resolve();
			}, 2_000);
			child.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
			child.kill('SIGTERM');
		});
	}
}
