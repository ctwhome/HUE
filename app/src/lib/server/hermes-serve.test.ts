import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesServe } from './hermes-serve';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length) await cleanups.pop()?.();
});

describe('HermesServe', () => {
	it('reports idle and ready administration health without exposing its token', () => {
		const hermes = new HermesServe();
		expect(hermes.healthStatus()).toBe('idle');
		Object.assign(hermes as object, {
			child: {},
			baseUrl: 'http://127.0.0.1:4174',
			token: 'must-not-leak'
		});
		expect(hermes.healthStatus()).toBe('ready');
	});

	it('reports administration unavailable after startup fails', async () => {
		const hermes = new HermesServe({ command: '/missing/hue-hermes' });

		await expect(hermes.start()).rejects.toThrow();
		expect(hermes.healthStatus()).toBe('unavailable');
		await hermes.close();
	});

	it('starts isolated Hermes once and authenticates API requests', async () => {
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				return Response.json({ token: request.headers.get('x-hermes-session-token') });
			}
		});
		const directory = mkdtempSync(join(tmpdir(), 'hue-hermes-serve-'));
		const command = join(directory, 'hermes');
		const argsPath = join(directory, 'args');
		const parentPath = join(directory, 'parent');
		writeFileSync(
			command,
			`#!/bin/sh\nprintf '%s' "$*" > '${argsPath}'\nprintf '%s' "$HERMES_PARENT_PID" > '${parentPath}'\nprintf 'HERMES_BACKEND_READY port=${server.port}\\n'\nwhile :; do sleep 1; done\n`
		);
		chmodSync(command, 0o700);
		const hermes = new HermesServe({ command, profile: 'worker' });
		cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
		cleanups.push(() => server.stop(true));
		cleanups.push(() => hermes.close());

		const first = await hermes.request('/api/mcp/servers');
		const second = await hermes.request('/api/profiles');

		expect((await first.json()).token).toHaveLength(64);
		expect((await second.json()).token).toHaveLength(64);
		expect(readFileSync(argsPath, 'utf8')).toBe(
			'--profile worker serve --isolated --host 127.0.0.1 --port 0'
		);
		expect(readFileSync(parentPath, 'utf8')).toBe(String(process.pid));
	});

	it('refuses URLs that could send the session token outside the Hermes API', async () => {
		const hermes = new HermesServe();

		await expect(hermes.request('https://example.com/api/profiles')).rejects.toThrow(
			'Hermes API path must start with /api/'
		);
		await expect(hermes.request('/dashboard')).rejects.toThrow(
			'Hermes API path must start with /api/'
		);
	});

	it('reports Hermes API errors without exposing an unactionable status only', async () => {
		const hermes = new HermesServe();
		const internals = hermes as unknown as {
			request: () => Promise<Response>;
			json: (path: string) => Promise<unknown>;
		};
		internals.request = async () =>
			Response.json({ detail: 'MCP config is invalid' }, { status: 400 });

		await expect(internals.json('/api/mcp/servers')).rejects.toThrow('MCP config is invalid');
	});

	it('removes MCP credentials before returning servers to HUE routes', async () => {
		const hermes = new HermesServe();
		const internals = hermes as unknown as {
			json: () => Promise<unknown>;
		};
		internals.json = async () => ({
			servers: [
				{
					name: 'filesystem',
					transport: 'stdio',
					command: 'mcp-filesystem',
					enabled: true,
					env: { API_TOKEN: 'secret' },
					auth: 'secret'
				},
				{
					name: 'remote',
					transport: 'http',
					url: 'https://user:password@example.test/mcp?token=secret#private',
					enabled: true
				}
			]
		});

		expect(await hermes.mcpServers()).toEqual({
			servers: [
				{
					name: 'filesystem',
					transport: 'stdio',
					command: 'mcp-filesystem',
					url: null,
					enabled: true
				},
				{
					name: 'remote',
					transport: 'http',
					command: null,
					url: 'https://example.test/mcp',
					enabled: true
				}
			]
		});
	});

	it('forwards browser recordings to Hermes transcription', async () => {
		const hermes = new HermesServe();
		const requests: Array<{ path: string; init: RequestInit }> = [];
		const internals = hermes as unknown as {
			json: (path: string, init: RequestInit) => Promise<unknown>;
		};
		internals.json = async (path, init) => {
			requests.push({ path, init });
			return { transcript: 'Hello Hermes' };
		};

		expect(await hermes.transcribeAudio('data:audio/webm;base64,AAAA', 'audio/webm')).toEqual({
			text: 'Hello Hermes'
		});
		expect(requests).toEqual([
			{
				path: '/api/audio/transcribe',
				init: {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						data_url: 'data:audio/webm;base64,AAAA',
						mime_type: 'audio/webm'
					})
				}
			}
		]);
	});

	it('proxies Hermes streaming PCM without exposing its session token', async () => {
		const frames: unknown[] = [];
		const server = Bun.serve({
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request)) return;
				return new Response('upgrade required', { status: 426 });
			},
			websocket: {
				open(socket) {
					socket.send(JSON.stringify({ type: 'start', sample_rate: 24_000, channels: 1 }));
				},
				message(socket, message) {
					const frame = JSON.parse(String(message)) as { done?: boolean };
					frames.push(frame);
					if (frame.done) {
						socket.send(new Uint8Array([1, 0, 2, 0]));
						socket.send(JSON.stringify({ type: 'end' }));
					}
				}
			}
		});
		cleanups.push(() => server.stop(true));
		const hermes = new HermesServe();
		Object.assign(hermes as object, {
			child: {},
			baseUrl: `http://127.0.0.1:${server.port}`,
			token: 'server-secret'
		});

		const response = await hermes.speakAudio('Hello there.');

		expect(response.headers.get('content-type')).toBe('audio/L16');
		expect(response.headers.get('x-audio-sample-rate')).toBe('24000');
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 0, 2, 0]);
		expect(frames).toEqual([{ text: 'Hello there.' }, { done: true }]);
	});

	it('falls back to complete speech audio for non-streaming providers', async () => {
		const server = Bun.serve({
			port: 0,
			fetch(request, server) {
				if (request.headers.get('upgrade') === 'websocket') {
					if (server.upgrade(request)) return;
				}
				return Response.json({
					data_url: 'data:audio/mpeg;base64,AQID',
					mime_type: 'audio/mpeg'
				});
			},
			websocket: {
				open(socket) {
					socket.send(JSON.stringify({ type: 'fallback' }));
				},
				message() {}
			}
		});
		cleanups.push(() => server.stop(true));
		const hermes = new HermesServe();
		Object.assign(hermes as object, {
			child: {},
			baseUrl: `http://127.0.0.1:${server.port}`,
			token: 'server-secret'
		});

		const response = await hermes.speakAudio('Fallback voice');

		expect(response.headers.get('content-type')).toBe('audio/mpeg');
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
	});

	it('closes a pending speech stream when the request is aborted', async () => {
		let closed = false;
		let resolveOpened!: () => void;
		const opened = new Promise<void>((resolve) => (resolveOpened = resolve));
		const server = Bun.serve({
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request)) return;
				return new Response('upgrade required', { status: 426 });
			},
			websocket: {
				open() {
					resolveOpened();
				},
				message() {},
				close() {
					closed = true;
				}
			}
		});
		cleanups.push(() => server.stop(true));
		const hermes = new HermesServe();
		Object.assign(hermes as object, {
			child: {},
			baseUrl: `http://127.0.0.1:${server.port}`,
			token: 'server-secret'
		});
		const abort = new AbortController();

		const speech = hermes.speakAudio('Stop this', abort.signal);
		await opened;
		abort.abort();

		await expect(speech).rejects.toMatchObject({ name: 'AbortError' });
		await Bun.sleep(10);
		expect(closed).toBe(true);
	});

	it('errors the audio response when Hermes closes before the stream ends', async () => {
		const server = Bun.serve({
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request)) return;
				return new Response('upgrade required', { status: 426 });
			},
			websocket: {
				open(socket) {
					socket.send(JSON.stringify({ type: 'start', sample_rate: 24_000, channels: 1 }));
					setTimeout(() => socket.terminate(), 10);
				},
				message() {}
			}
		});
		cleanups.push(() => {
			void server.stop(false);
		});
		const hermes = new HermesServe();
		Object.assign(hermes as object, {
			child: {},
			baseUrl: `http://127.0.0.1:${server.port}`,
			token: 'server-secret'
		});

		const response = await hermes.speakAudio('Incomplete stream');

		expect((await response.arrayBuffer()).byteLength).toBe(0);
	});
});
