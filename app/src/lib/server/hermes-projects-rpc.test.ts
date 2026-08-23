import { afterEach, describe, expect, it } from 'bun:test';
import { HermesProjectsRpc } from './hermes-projects-rpc';

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	while (servers.length) await servers.pop()?.stop(true);
});

function rpcServer(
	onMessage: (
		socket: { send(data: string): void },
		frame: { id: string; method: string; params: Record<string, unknown> }
	) => void
) {
	const server = Bun.serve({
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return;
			return new Response('upgrade required', { status: 426 });
		},
		websocket: {
			message(socket, message) {
				onMessage(socket, JSON.parse(String(message)));
			}
		}
	});
	servers.push(server);
	return `ws://127.0.0.1:${server.port}/api/ws?token=test-only`;
}

describe('HermesProjectsRpc', () => {
	it('matches concurrent out-of-order responses by unique request id', async () => {
		const frames: Array<{ id: string; method: string; params: Record<string, unknown> }> = [];
		const url = rpcServer((socket, frame) => {
			frames.push(frame);
			if (frames.length !== 2) return;
			for (const response of [...frames].reverse()) {
				socket.send(JSON.stringify({ jsonrpc: '2.0', id: response.id, result: response.method }));
			}
		});
		const rpc = new HermesProjectsRpc({ requestTimeoutMs: 1_000 });

		const [first, second] = await Promise.all([
			rpc.request<string>(url, 'projects.list'),
			rpc.request<string>(url, 'projects.get', { id: 'p_1' })
		]);

		expect([first, second]).toEqual(['projects.list', 'projects.get']);
		expect(new Set(frames.map(({ id }) => id)).size).toBe(2);
		rpc.close();
	});

	it('times out one request, ignores its late response, and keeps socket usable', async () => {
		const url = rpcServer((socket, frame) => {
			if (frame.method === 'projects.list') {
				setTimeout(
					() => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: 'late' })),
					40
				);
			} else {
				socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: 'current' }));
			}
		});
		const rpc = new HermesProjectsRpc({ requestTimeoutMs: 10 });

		await expect(rpc.request(url, 'projects.list')).rejects.toThrow(
			'Hermes Projects request timed out'
		);
		await Bun.sleep(60);
		await expect(rpc.request(url, 'projects.get', { id: 'p_1' })).resolves.toBe('current');
		rpc.close();
	});

	it('rejects pending requests when closed and never includes credentials in errors', async () => {
		const url = rpcServer(() => undefined);
		const rpc = new HermesProjectsRpc({ requestTimeoutMs: 1_000 });
		const pending = rpc.request(url, 'projects.list');
		await Bun.sleep(10);

		rpc.close();

		await expect(pending).rejects.toThrow('Hermes Projects connection closed');
		await expect(
			rpc.request('ws://127.0.0.1:1/api/ws?token=super-secret', 'projects.list')
		).rejects.not.toThrow('super-secret');
	});

	it('rejects a request when closed during the connection handshake', async () => {
		const server = Bun.serve({
			port: 0,
			async fetch() {
				await Bun.sleep(500);
				return new Response('too late', { status: 503 });
			}
		});
		servers.push(server);
		const rpc = new HermesProjectsRpc({ connectTimeoutMs: 1_000 });
		const pending = rpc.request(`ws://127.0.0.1:${server.port}/api/ws`, 'projects.list');
		await Bun.sleep(10);

		rpc.close();

		await expect(
			Promise.race([
				pending,
				Bun.sleep(100).then(() => {
					throw new Error('request remained pending');
				})
			])
		).rejects.toThrow('Hermes Projects connection closed');
	});

	it('redacts Hermes RPC error data and identifies missing Projects capability', async () => {
		const url = rpcServer((socket, frame) => {
			socket.send(
				JSON.stringify({
					jsonrpc: '2.0',
					id: frame.id,
					error: {
						code: -32601,
						message: 'unknown method: projects.list token=secret-value',
						data: { api_key: 'secret-value' }
					}
				})
			);
		});
		const rpc = new HermesProjectsRpc();

		try {
			await rpc.request(url, 'projects.list');
			throw new Error('expected request failure');
		} catch (cause) {
			expect(cause).toMatchObject({ code: -32601, capabilityMissing: true });
			expect(String(cause)).not.toContain('secret-value');
		}
		rpc.close();
	});
});
