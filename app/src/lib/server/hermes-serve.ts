import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

type HermesServeOptions = {
	command?: string;
	profile?: string;
	onDiagnostic?: (message: string) => void;
};

export type HermesMcpServer = {
	name: string;
	transport: string;
	url: string | null;
	command: string | null;
	enabled: boolean;
};

export class HermesServe {
	private readonly command: string;
	private readonly profile: string;
	private readonly onDiagnostic?: (message: string) => void;
	private child: ChildProcessWithoutNullStreams | null = null;
	private baseUrl: string | null = null;
	private token: string | null = null;
	private starting: Promise<void> | null = null;
	private closing = false;
	private unavailable = false;

	constructor(options: HermesServeOptions = {}) {
		this.command = options.command ?? 'hermes';
		this.profile = options.profile ?? 'default';
		this.onDiagnostic = options.onDiagnostic;
	}

	healthStatus(): 'idle' | 'ready' | 'unavailable' {
		if (this.child && this.baseUrl && this.token) return 'ready';
		return this.unavailable ? 'unavailable' : 'idle';
	}

	profileName() {
		return this.profile;
	}

	async start(): Promise<void> {
		if (this.child && this.baseUrl && this.token) return;
		if (this.starting) return this.starting;
		this.closing = false;
		this.starting = this.open();
		try {
			await this.starting;
			this.unavailable = false;
		} catch (error) {
			this.unavailable = true;
			throw error;
		} finally {
			this.starting = null;
		}
	}

	private async open(): Promise<void> {
		const token = randomBytes(32).toString('hex');
		const args = [
			...(this.profile === 'default' ? [] : ['--profile', this.profile]),
			'serve',
			'--isolated',
			'--host',
			'127.0.0.1',
			'--port',
			'0'
		];
		const child = spawn(this.command, args, {
			env: {
				...process.env,
				HERMES_DASHBOARD_SESSION_TOKEN: token,
				HERMES_PARENT_PID: String(process.pid)
			},
			stdio: ['pipe', 'pipe', 'pipe']
		}) as ChildProcessWithoutNullStreams;
		this.child = child;

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			const diagnostic = chunk.trim();
			if (diagnostic) this.onDiagnostic?.(diagnostic);
		});

		try {
			const port = await this.readyPort(child);
			const baseUrl = `http://127.0.0.1:${port}`;
			const response = await fetch(`${baseUrl}/api/health`, {
				headers: { 'X-Hermes-Session-Token': token }
			});
			if (!response.ok) throw new Error(`Hermes admin health check failed (${response.status})`);
			this.baseUrl = baseUrl;
			this.token = token;
		} catch (error) {
			child.kill('SIGTERM');
			if (this.child === child) this.child = null;
			throw error;
		}

		child.once('exit', (code, signal) => {
			if (this.child !== child) return;
			this.child = null;
			this.baseUrl = null;
			this.token = null;
			if (!this.closing) {
				this.unavailable = true;
				this.onDiagnostic?.(
					`Hermes admin exited unexpectedly (code=${String(code)}, signal=${String(signal)})`
				);
			}
		});
	}

	private readyPort(child: ChildProcessWithoutNullStreams): Promise<number> {
		return new Promise((resolve, reject) => {
			const lines = createInterface({ input: child.stdout });
			const timeout = setTimeout(() => finish(new Error('Hermes admin startup timed out')), 15_000);
			const finish = (error?: Error, port?: number) => {
				clearTimeout(timeout);
				lines.close();
				child.off('error', onError);
				child.off('exit', onExit);
				if (error) reject(error);
				else resolve(port!);
			};
			const onError = (error: Error) => finish(error);
			const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
				finish(
					new Error(
						`Hermes admin exited before startup (code=${String(code)}, signal=${String(signal)})`
					)
				);
			child.once('error', onError);
			child.once('exit', onExit);
			lines.on('line', (line) => {
				const match = line.match(/^HERMES_BACKEND_READY port=(\d+)$/);
				if (match) finish(undefined, Number(match[1]));
			});
		});
	}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		if (!path.startsWith('/api/')) throw new Error('Hermes API path must start with /api/');
		await this.start();
		const headers = new Headers(init.headers);
		headers.set('X-Hermes-Session-Token', this.token!);
		return fetch(`${this.baseUrl}${path}`, { ...init, headers });
	}

	async json<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.request(path, init);
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
			throw new Error(
				typeof body?.detail === 'string'
					? body.detail
					: `Hermes API request failed (${response.status})`
			);
		}
		return (await response.json()) as T;
	}

	async mcpServers(): Promise<{ servers: HermesMcpServer[] }> {
		const body = await this.json<{ servers?: unknown }>('/api/mcp/servers');
		const safeUrl = (value: unknown) => {
			if (typeof value !== 'string') return null;
			try {
				const url = new URL(value);
				url.username = '';
				url.password = '';
				url.search = '';
				url.hash = '';
				return url.toString().replace(/\/$/, '');
			} catch {
				return null;
			}
		};
		return {
			servers: Array.isArray(body.servers)
				? body.servers.flatMap((value) => {
						if (!value || typeof value !== 'object') return [];
						const server = value as Record<string, unknown>;
						if (typeof server.name !== 'string') return [];
						return [
							{
								name: server.name,
								transport: typeof server.transport === 'string' ? server.transport : 'unknown',
								url: safeUrl(server.url),
								command: typeof server.command === 'string' ? server.command : null,
								enabled: server.enabled === true
							}
						];
					})
				: []
		};
	}

	async transcribeAudio(
		dataUrl: string,
		mimeType: string,
		signal?: AbortSignal
	): Promise<{ text: string }> {
		const body = await this.json<{ transcript?: unknown }>('/api/audio/transcribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ data_url: dataUrl, mime_type: mimeType }),
			signal
		});
		return { text: typeof body.transcript === 'string' ? body.transcript : '' };
	}

	async speakAudio(text: string, signal?: AbortSignal): Promise<Response> {
		if (!text.trim()) throw new Error('Speech text is required');
		await this.start();
		try {
			return await this.streamSpeech(text, signal);
		} catch (cause) {
			if (
				!(cause instanceof Error) ||
				cause.message !== 'The configured Hermes voice does not support streaming'
			) {
				throw cause;
			}
			const body = await this.json<{ data_url: string; mime_type: string }>('/api/audio/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
				signal
			});
			const encoded = body.data_url.split(',', 2)[1];
			if (!encoded) throw new Error('Hermes returned invalid speech audio');
			return new Response(Buffer.from(encoded, 'base64'), {
				headers: { 'content-type': body.mime_type, 'cache-control': 'no-store' }
			});
		}
	}

	private async streamSpeech(text: string, signal?: AbortSignal): Promise<Response> {
		const url = new URL('/api/audio/speak-stream', this.baseUrl!);
		url.protocol = 'ws:';
		url.searchParams.set('token', this.token!);
		if (this.profile !== 'default') url.searchParams.set('profile', this.profile);

		return new Promise<Response>((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.binaryType = 'arraybuffer';
			let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
			let settled = false;
			let ended = false;
			let timeout: ReturnType<typeof setTimeout>;
			const armTimeout = (milliseconds: number) => {
				clearTimeout(timeout);
				timeout = setTimeout(() => fail(new Error('Hermes speech stream timed out')), milliseconds);
			};
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener('abort', onAbort);
			};
			const fail = (error: Error) => {
				if (ended) return;
				ended = true;
				cleanup();
				if (settled) controller?.error(error);
				else reject(error);
				socket.close();
			};
			const onAbort = () => fail(new DOMException('Speech request aborted', 'AbortError'));
			if (signal?.aborted) return onAbort();
			signal?.addEventListener('abort', onAbort, { once: true });
			armTimeout(15_000);

			socket.onopen = () => {
				socket.send(JSON.stringify({ text }));
				socket.send(JSON.stringify({ done: true }));
			};
			socket.onmessage = (event) => {
				armTimeout(60_000);
				if (typeof event.data !== 'string') {
					controller?.enqueue(new Uint8Array(event.data as ArrayBuffer));
					return;
				}
				let frame: { type?: string; sample_rate?: number };
				try {
					frame = JSON.parse(event.data) as typeof frame;
				} catch {
					return;
				}
				if (frame.type === 'start' && !settled) {
					const stream = new ReadableStream<Uint8Array>({
						start(value) {
							controller = value;
						},
						cancel() {
							ended = true;
							cleanup();
							socket.close();
						}
					});
					settled = true;
					resolve(
						new Response(stream, {
							headers: {
								'content-type': 'audio/L16',
								'cache-control': 'no-store',
								'x-audio-sample-rate': String(frame.sample_rate ?? 24_000)
							}
						})
					);
				} else if (frame.type === 'end') {
					ended = true;
					cleanup();
					controller?.close();
					socket.close();
				} else if (frame.type === 'fallback') {
					fail(new Error('The configured Hermes voice does not support streaming'));
				}
			};
			socket.onerror = () => {
				if (!settled) return fail(new Error('Hermes speech stream failed'));
				if (ended) return;
				ended = true;
				cleanup();
				controller?.close();
				socket.close();
			};
			socket.onclose = () => {
				cleanup();
				if (ended) return;
				ended = true;
				if (!settled) reject(new Error('Hermes speech stream closed before audio started'));
				else controller?.close();
			};
		});
	}

	async close(): Promise<void> {
		this.closing = true;
		this.unavailable = false;
		if (this.starting) await this.starting.catch(() => undefined);
		const child = this.child;
		if (!child) return;
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => child.kill('SIGKILL'), 2_000);
			child.once('exit', () => {
				clearTimeout(timeout);
				resolve();
			});
			child.kill('SIGTERM');
		});
	}
}
