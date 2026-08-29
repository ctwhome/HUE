import { describe, expect, it } from 'bun:test';
import { HermesAdmin, redactHermesValue, type HermesAdminTransport } from './hermes-admin';

class FakeTransport implements HermesAdminTransport {
	requests: Array<{ path: string; init: RequestInit }> = [];
	responses = new Map<string, unknown>();

	async json<T>(path: string, init: RequestInit = {}): Promise<T> {
		this.requests.push({ path, init });
		const key = `${init.method ?? 'GET'} ${path}`;
		if (!this.responses.has(key)) throw new Error(`Missing fixture: ${key}`);
		return this.responses.get(key) as T;
	}
}

describe('Hermes administration boundary', () => {
	it('redacts nested secrets, credential URLs, bearer text, and secret-looking environment keys', () => {
		expect(
			redactHermesValue({
				token: 'top-secret',
				authenticated: true,
				server: {
					url: 'https://alice:password@example.test/mcp?api_key=secret#private',
					env: { PUBLIC_NAME: 'safe', API_TOKEN: 'secret', PASSWORD: 'secret' }
				},
				logs: ['Authorization: Bearer abc.def.ghi', 'OPENAI_API_KEY=sk-private'],
				accessToken: 'camel-secret',
				client_secret: 'snake-secret',
				'bearer-token': 'kebab-secret',
				error: 'failed https://alice:password@example.test/mcp?accessToken=secret#private now'
			})
		).toEqual({
			token: '[REDACTED]',
			authenticated: true,
			server: {
				url: 'https://example.test/mcp',
				env: { PUBLIC_NAME: 'safe', API_TOKEN: '[REDACTED]', PASSWORD: '[REDACTED]' }
			},
			logs: ['Authorization: Bearer [REDACTED]', 'OPENAI_API_KEY=[REDACTED]'],
			accessToken: '[REDACTED]',
			client_secret: '[REDACTED]',
			'bearer-token': '[REDACTED]',
			error: 'failed https://example.test/mcp now'
		});
	});

	it('reports missing upstream memory editor/history and skill linked-file seams', async () => {
		const transport = new FakeTransport();
		transport.responses.set('GET /api/memory', {
			active: 'builtin',
			builtin_files: { memory: 10, user: 20 }
		});

		expect(await new HermesAdmin(transport).view('memory')).toEqual({
			capabilities: {
				memoryStatus: true,
				memoryEditor: false,
				memoryHistory: false,
				skillDelete: true,
				skillLinkedFiles: false
			},
			status: { active: 'builtin', builtin_files: { memory: 10, user: 20 } },
			unsupported: [
				'Hermes v0.20.5 has no authenticated memory document read/write/history API.',
				'Hermes v0.20.5 has no authenticated custom-skill linked-file API.'
			]
		});
	});

	it('loads skills through Hermes with provenance and enable support', async () => {
		const transport = new FakeTransport();
		transport.responses.set('GET /api/skills', [
			{
				name: 'author',
				description: 'Write',
				category: 'writing',
				enabled: true,
				provenance: 'agent'
			}
		]);

		expect(await new HermesAdmin(transport).view('skills')).toEqual({
			capabilities: { create: true, edit: true, toggle: true, delete: true, linkedFiles: false },
			skills: [
				{
					name: 'author',
					description: 'Write',
					category: 'writing',
					enabled: true,
					provenance: 'agent'
				}
			],
			unsupported: ['Skill linked-file access requires a future Hermes admin API.']
		});
	});

	it('rejects skill edits that bypass the custom-skill ownership boundary', async () => {
		const transport = new FakeTransport();
		await expect(
			new HermesAdmin(transport).mutate('skill.update', {
				name: 'author',
				content: '---\nname: author\n---\n'
			})
		).rejects.toThrow('custom-skill ownership boundary');
		expect(transport.requests).toEqual([]);
	});

	it('loads profile status and reads active profile back after switching', async () => {
		const transport = new FakeTransport();
		transport.responses.set('GET /api/profiles', {
			profiles: [{ name: 'default', model: 'gpt-5', provider: 'openai', skill_count: 12 }]
		});
		transport.responses.set('GET /api/profiles/active', { active: 'default', current: 'default' });
		transport.responses.set('POST /api/profiles/active', { ok: true, active: 'worker' });
		transport.responses.set('GET /api/profiles/active#after', {
			active: 'worker',
			current: 'default'
		});
		let activeReads = 0;
		const original = transport.json.bind(transport);
		transport.json = async <T>(path: string, init: RequestInit = {}) => {
			if (path === '/api/profiles/active' && !init.method && activeReads++ > 0) {
				transport.requests.push({ path, init });
				return transport.responses.get('GET /api/profiles/active#after') as T;
			}
			return original<T>(path, init);
		};

		const admin = new HermesAdmin(transport);
		expect(await admin.view('profiles')).toMatchObject({
			capabilities: { create: true, clone: true, switch: true, delete: true },
			active: { active: 'default', current: 'default' }
		});
		expect(await admin.mutate('profile.switch', { name: 'worker' })).toEqual({
			target: { active: 'worker', current: 'default' }
		});
	});

	it('keeps MCP secret inputs write-only and reads safe target back', async () => {
		const transport = new FakeTransport();
		transport.responses.set('POST /api/mcp/servers', {
			name: 'remote',
			url: 'https://example.test/mcp',
			enabled: true
		});
		transport.responses.set('GET /api/mcp/servers', {
			servers: [
				{
					name: 'remote',
					url: 'https://user:pass@example.test/mcp?token=secret',
					enabled: true,
					env: { API_TOKEN: 'secret' }
				}
			]
		});

		const result = await new HermesAdmin(transport).mutate('mcp.create', {
			name: 'remote',
			url: 'https://example.test/mcp',
			auth: 'header',
			bearerToken: 'write-only-secret'
		});

		expect(result).toEqual({
			target: {
				name: 'remote',
				url: 'https://example.test/mcp',
				enabled: true,
				env: { API_TOKEN: '[REDACTED]' }
			}
		});
		expect(String(transport.requests[0].init.body)).toContain('write-only-secret');
		expect(JSON.parse(String(transport.requests[0].init.body))).toEqual({
			name: 'remote',
			url: 'https://example.test/mcp',
			auth: 'header',
			bearer_token: 'write-only-secret'
		});
		expect(JSON.stringify(result)).not.toContain('write-only-secret');
	});

	it('rejects non-http MCP and OAuth authorization URLs', async () => {
		const admin = new HermesAdmin(new FakeTransport());
		await expect(
			admin.mutate('mcp.create', { name: 'bad', url: 'javascript:alert(1)', auth: 'oauth' })
		).rejects.toThrow('url must be an http(s) URL');

		const transport = new FakeTransport();
		transport.responses.set('POST /api/mcp/servers/remote/auth', {
			flow_id: 'flow-1',
			status: 'authorization_required',
			authorization_url: 'javascript:alert(1)'
		});
		await expect(new HermesAdmin(transport).mutate('mcp.auth', { name: 'remote' })).rejects.toThrow(
			'authorization_url must be an http(s) URL'
		);
	});

	it('returns a typed short-lived OAuth Open action and supports status polling and cancel', async () => {
		const transport = new FakeTransport();
		transport.responses.set('POST /api/mcp/servers/remote/auth', {
			flow_id: 'flow-1',
			status: 'authorization_required',
			authorization_url: 'https://idp.example/authorize?state=opaque'
		});
		transport.responses.set('GET /api/mcp/oauth/flows/flow-1', {
			flow_id: 'flow-1',
			status: 'approved',
			tools: [{ name: 'search' }]
		});
		transport.responses.set('DELETE /api/mcp/oauth/flows/flow-1', {
			ok: true,
			status: 'error'
		});
		const admin = new HermesAdmin(transport);

		expect(await admin.mutate('mcp.auth', { name: 'remote' })).toEqual({
			authorization: {
				flowId: 'flow-1',
				status: 'authorization_required',
				expiresInSeconds: 900,
				action: { type: 'open', url: 'https://idp.example/authorize?state=opaque' }
			}
		});
		expect(await admin.mutate('mcp.auth.status', { flowId: 'flow-1' })).toEqual({
			authorization: { flowId: 'flow-1', status: 'approved', tools: [{ name: 'search' }] }
		});
		expect(await admin.mutate('mcp.auth.cancel', { flowId: 'flow-1' })).toEqual({
			authorization: { flowId: 'flow-1', status: 'error', cancelled: true }
		});
	});

	it('loads credential-free model options and reads assignment back from Hermes', async () => {
		const transport = new FakeTransport();
		transport.responses.set('GET /api/model/options?include_unconfigured=1', {
			provider: 'openai',
			model: 'gpt-5',
			providers: [{ slug: 'openai', name: 'OpenAI', models: ['gpt-5'], authenticated: true }]
		});
		transport.responses.set('POST /api/model/set', {
			ok: true,
			provider: 'openai',
			model: 'gpt-5'
		});
		transport.responses.set('GET /api/model/info', { provider: 'openai', model: 'gpt-5' });

		const admin = new HermesAdmin(transport);
		expect(await admin.view('models')).toMatchObject({
			capabilities: { validatedAssignment: true, browserCredentials: false }
		});
		expect(await admin.mutate('model.set', { provider: 'openai', model: 'gpt-5' })).toEqual({
			target: { provider: 'openai', model: 'gpt-5' }
		});
	});

	it('requires exact confirmation for destructive mutations', async () => {
		const admin = new HermesAdmin(new FakeTransport());
		await expect(admin.mutate('profile.delete', { name: 'worker' })).rejects.toThrow(
			'Type worker to confirm deletion'
		);
	});
});
