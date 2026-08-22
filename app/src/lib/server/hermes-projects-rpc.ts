import { redactHermesValue } from './redaction';

type RpcId = string;
type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (cause: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

type HermesProjectsRpcOptions = {
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
};

export class HermesProjectsRpcError extends Error {
	readonly capabilityMissing: boolean;
	readonly code?: number;

	constructor(message: string, code?: number) {
		super(message);
		this.name = 'HermesProjectsRpcError';
		this.code = code;
		this.capabilityMissing = code === -32601;
	}
}

export class HermesProjectsRpc {
	private socket: WebSocket | null = null;
	private socketUrl = '';
	private connecting: Promise<WebSocket> | null = null;
	private rejectConnection: ((cause: Error) => void) | null = null;
	private nextId = 0;
	private readonly pending = new Map<RpcId, PendingRequest>();
	private readonly connectTimeoutMs: number;
	private readonly requestTimeoutMs: number;

	constructor(options: HermesProjectsRpcOptions = {}) {
		this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
	}

	async request<T>(url: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
		const socket = await this.connect(url);
		const id = `hue-projects-${++this.nextId}`;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				reject(new Error('Hermes Projects request timed out'));
			}, this.requestTimeoutMs);
			this.pending.set(id, {
				timer,
				resolve: (value) => resolve(value as T),
				reject
			});
			try {
				socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
			} catch {
				this.finish(id, new Error('Hermes Projects connection closed'));
			}
		});
	}

	close() {
		const socket = this.socket;
		const rejectConnection = this.rejectConnection;
		this.socket = null;
		this.socketUrl = '';
		this.connecting = null;
		this.rejectConnection = null;
		try {
			socket?.close();
		} finally {
			rejectConnection?.(new Error('Hermes Projects connection closed'));
			this.rejectPending(new Error('Hermes Projects connection closed'));
		}
	}

	private async connect(url: string): Promise<WebSocket> {
		let parsed: URL;
		try {
			parsed = new URL(url);
			if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error();
		} catch {
			throw new Error('Hermes Projects connection failed');
		}
		if (this.socket?.readyState === WebSocket.OPEN && this.socketUrl === parsed.href) {
			return this.socket;
		}
		if (this.connecting && this.socketUrl === parsed.href) return this.connecting;
		if (this.socket || this.socketUrl !== parsed.href) this.close();
		this.socketUrl = parsed.href;
		const socket = new WebSocket(parsed.href);
		this.socket = socket;
		this.connecting = new Promise<WebSocket>((resolve, reject) => {
			this.rejectConnection = reject;
			let settled = false;
			const timeout = setTimeout(() => fail(), this.connectTimeoutMs);
			const cleanup = () => {
				clearTimeout(timeout);
				socket.removeEventListener('open', opened);
				socket.removeEventListener('error', fail);
			};
			const opened = () => {
				if (settled || this.socket !== socket) return;
				settled = true;
				cleanup();
				this.rejectConnection = null;
				resolve(socket);
			};
			const fail = () => {
				if (settled || this.socket !== socket) return;
				settled = true;
				cleanup();
				this.rejectConnection = null;
				this.socket = null;
				this.socketUrl = '';
				try {
					socket.close();
				} catch {
					// Connection already failed.
				}
				reject(new Error('Hermes Projects connection failed'));
			};
			socket.addEventListener('open', opened, { once: true });
			socket.addEventListener('error', fail, { once: true });
		});
		socket.addEventListener('message', (event) => {
			if (this.socket !== socket) return;
			this.handleMessage(event.data);
		});
		socket.addEventListener('close', () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.socketUrl = '';
			this.connecting = null;
			this.rejectPending(new Error('Hermes Projects connection closed'));
		});
		try {
			return await this.connecting;
		} finally {
			if (this.socket === socket) this.connecting = null;
		}
	}

	private handleMessage(raw: unknown) {
		let frame: {
			id?: unknown;
			result?: unknown;
			error?: { code?: unknown; message?: unknown; data?: unknown };
		};
		try {
			frame = JSON.parse(typeof raw === 'string' ? raw : String(raw));
		} catch {
			return;
		}
		if (typeof frame.id !== 'string' || !this.pending.has(frame.id)) return;
		if (frame.error) {
			const code = typeof frame.error.code === 'number' ? frame.error.code : undefined;
			const message = String(
				redactHermesValue(frame.error.message ?? 'Hermes Projects request failed')
			);
			this.finish(frame.id, new HermesProjectsRpcError(message, code));
			return;
		}
		this.finish(frame.id, undefined, frame.result);
	}

	private finish(id: RpcId, cause?: Error, value?: unknown) {
		const pending = this.pending.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(id);
		if (cause) pending.reject(cause);
		else pending.resolve(value);
	}

	private rejectPending(cause: Error) {
		for (const id of [...this.pending.keys()]) this.finish(id, cause);
	}
}
