import { redactHermesValue } from './redaction';

export { redactHermesValue } from './redaction';

export interface HermesAdminTransport {
	json<T>(path: string, init?: RequestInit): Promise<T>;
}

export type HermesAdminView = 'runtime' | 'memory' | 'skills' | 'profiles' | 'mcp' | 'models';

export type HermesAdminAction =
	| 'skill.create'
	| 'skill.update'
	| 'skill.toggle'
	| 'profile.create'
	| 'profile.switch'
	| 'profile.delete'
	| 'profile.model'
	| 'mcp.create'
	| 'mcp.toggle'
	| 'mcp.test'
	| 'mcp.auth'
	| 'mcp.auth.status'
	| 'mcp.auth.cancel'
	| 'mcp.delete'
	| 'model.set';

export type HermesOAuthAuthorization = {
	flowId: string;
	status: unknown;
	expiresInSeconds?: number;
	action?: { type: 'open'; url: string };
	tools?: unknown[];
	error?: unknown;
	cancelled?: true;
};

type Input = Record<string, unknown>;

function required(input: Input, key: string, maximum = 10_000): string {
	const value = input[key];
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
	if (value.length > maximum || value.includes('\0')) throw new Error(`${key} is invalid`);
	return value.trim();
}

function encoded(input: Input, key: string): string {
	return encodeURIComponent(required(input, key, 128));
}

function httpUrl(input: Input, key: string): string {
	const value = required(input, key, 4_096);
	try {
		const url = new URL(value);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
			throw new Error();
		return url.toString();
	} catch {
		throw new Error(`${key} must be an http(s) URL without embedded credentials`);
	}
}

function body(value: unknown): RequestInit {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(value)
	};
}

function method(name: 'PUT' | 'DELETE', value?: unknown): RequestInit {
	return {
		method: name,
		...(value === undefined
			? {}
			: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
	};
}

function safe<T>(value: T): T {
	return redactHermesValue(value) as T;
}

export class HermesAdmin {
	constructor(private readonly transport: HermesAdminTransport) {}

	async view(view: HermesAdminView): Promise<Record<string, unknown>> {
		if (view === 'skills') {
			return safe({
				capabilities: { create: true, edit: true, toggle: true, delete: true, linkedFiles: false },
				skills: await this.transport.json<unknown[]>('/api/skills'),
				unsupported: ['Skill linked-file access requires a future Hermes admin API.']
			});
		}
		if (view === 'profiles') {
			const [profiles, active] = await Promise.all([
				this.transport.json<{ profiles?: unknown[] }>('/api/profiles'),
				this.transport.json('/api/profiles/active')
			]);
			return safe({
				capabilities: { create: true, clone: true, switch: true, delete: true },
				profiles: profiles.profiles ?? [],
				active
			});
		}
		if (view === 'mcp') {
			const result = await this.transport.json<{ servers?: unknown[] }>('/api/mcp/servers');
			return safe({
				capabilities: { configure: true, toggle: true, health: true, auth: true, tools: true },
				servers: result.servers ?? []
			});
		}
		if (view === 'models') {
			return safe({
				capabilities: { validatedAssignment: true, browserCredentials: false },
				options: await this.transport.json('/api/model/options?include_unconfigured=1')
			});
		}
		if (view === 'memory') {
			return safe({
				capabilities: {
					memoryStatus: true,
					memoryEditor: false,
					memoryHistory: false,
					skillDelete: true,
					skillLinkedFiles: false
				},
				status: await this.transport.json('/api/memory'),
				unsupported: [
					'Hermes v0.20.5 has no authenticated memory document read/write/history API.',
					'Hermes v0.20.5 has no authenticated custom-skill linked-file API.'
				]
			});
		}
		const [health, status, logs, update] = await Promise.all([
			this.transport.json('/api/health'),
			this.transport.json('/api/status'),
			this.transport.json('/api/logs?file=errors&lines=100'),
			this.transport.json('/api/hermes/update/check')
		]);
		return safe({
			capabilities: { logs: true, updateCheck: true, adminRestart: true, acpReconnect: true },
			health,
			status,
			logs,
			update
		});
	}

	async detail(kind: 'skill' | 'mcp', id: string): Promise<Record<string, unknown>> {
		const name = encodeURIComponent(id.trim());
		if (!name) throw new Error('id is required');
		if (kind === 'skill') {
			const target = await this.transport.json<Record<string, unknown>>(
				`/api/skills/content?name=${name}`
			);
			return safe({ target: { name: target.name, content: target.content } });
		}
		return safe({ target: await this.mcpTarget(decodeURIComponent(name)) });
	}

	async mutate(action: HermesAdminAction, input: Input): Promise<Record<string, unknown>> {
		if (action.startsWith('skill.')) return this.skill(action, input);
		if (action.startsWith('profile.')) return this.profile(action, input);
		if (action.startsWith('mcp.')) return this.mcp(action, input);
		return this.model(input);
	}

	private async skill(action: HermesAdminAction, input: Input) {
		const name = required(input, 'name', 128);
		if (action === 'skill.toggle') {
			if (typeof input.enabled !== 'boolean') throw new Error('enabled is required');
			await this.transport.json(
				'/api/skills/toggle',
				method('PUT', { name, enabled: input.enabled })
			);
			const skills = await this.transport.json<Array<Record<string, unknown>>>('/api/skills');
			return safe({ target: skills.find((skill) => skill.name === name) ?? null });
		}
		const content = required(input, 'content', 1_000_000);
		if (action === 'skill.create') {
			await this.transport.json('/api/skills', body({ name, content, category: input.category }));
		} else {
			throw new Error('Skill edits require the custom-skill ownership boundary');
		}
		const target = await this.transport.json<Record<string, unknown>>(
			`/api/skills/content?name=${encodeURIComponent(name)}`
		);
		return safe({ target: { name: target.name, content: target.content } });
	}

	private async profile(action: HermesAdminAction, input: Input) {
		const name = required(input, 'name', 64);
		if (action === 'profile.create') {
			await this.transport.json(
				'/api/profiles',
				body({
					name,
					...(typeof input.cloneFrom === 'string' && input.cloneFrom
						? { clone_from: input.cloneFrom }
						: {})
				})
			);
			return safe({ target: await this.profileTarget(name) });
		}
		if (action === 'profile.switch') {
			await this.transport.json('/api/profiles/active', body({ name }));
			return safe({ target: await this.transport.json('/api/profiles/active') });
		}
		if (action === 'profile.delete') {
			if (input.confirm !== name) throw new Error(`Type ${name} to confirm deletion`);
			const deleted = await this.profileTarget(name);
			await this.transport.json(`/api/profiles/${encodeURIComponent(name)}`, method('DELETE'));
			const profiles = await this.transport.json<{ profiles?: Array<{ name?: string }> }>(
				'/api/profiles'
			);
			return safe({
				deleted,
				verifiedAbsent: !(profiles.profiles ?? []).some((item) => item.name === name)
			});
		}
		const provider = required(input, 'provider', 128);
		const model = required(input, 'model', 256);
		await this.transport.json(
			`/api/profiles/${encodeURIComponent(name)}/model`,
			method('PUT', { provider, model })
		);
		return safe({ target: await this.profileTarget(name) });
	}

	private async profileTarget(name: string) {
		const result = await this.transport.json<{ profiles?: Array<Record<string, unknown>> }>(
			'/api/profiles'
		);
		return (result.profiles ?? []).find((profile) => profile.name === name) ?? null;
	}

	private async mcp(action: HermesAdminAction, input: Input) {
		if (action === 'mcp.auth.status' || action === 'mcp.auth.cancel') {
			const flowId = encoded(input, 'flowId');
			const result = await this.transport.json<Record<string, unknown>>(
				`/api/mcp/oauth/flows/${flowId}`,
				action === 'mcp.auth.cancel' ? method('DELETE') : undefined
			);
			const authorization: HermesOAuthAuthorization = {
				flowId: decodeURIComponent(flowId),
				status: result.status,
				...(action === 'mcp.auth.cancel' ? { cancelled: true } : {}),
				...(Array.isArray(result.tools) ? { tools: safe(result.tools) } : {}),
				...(typeof result.error_message === 'string' ? { error: safe(result.error_message) } : {})
			};
			return { authorization };
		}
		const name = required(input, 'name', 128);
		const path = `/api/mcp/servers/${encodeURIComponent(name)}`;
		if (action === 'mcp.create') {
			const rawUrl = typeof input.url === 'string' && input.url.trim() ? httpUrl(input, 'url') : '';
			const command = typeof input.command === 'string' ? input.command.trim() : '';
			if (Boolean(rawUrl) === Boolean(command))
				throw new Error('Exactly one MCP url or command is required');
			const auth = input.auth === 'header' || input.auth === 'oauth' ? input.auth : undefined;
			if (command && auth) throw new Error('MCP auth modes are supported only for http(s) servers');
			if (
				auth === 'header' &&
				!(typeof input.bearerToken === 'string' && input.bearerToken.trim())
			) {
				throw new Error('bearerToken is required for header authentication');
			}
			await this.transport.json(
				'/api/mcp/servers',
				body({
					name,
					...(rawUrl ? { url: rawUrl } : {}),
					...(command ? { command } : {}),
					...(Array.isArray(input.args) ? { args: input.args } : {}),
					...(input.env && typeof input.env === 'object' ? { env: input.env } : {}),
					...(auth ? { auth } : {}),
					...(typeof input.bearerToken === 'string' && input.bearerToken
						? { bearer_token: input.bearerToken }
						: {})
				})
			);
			return safe({ target: await this.mcpTarget(name) });
		}
		if (action === 'mcp.delete') {
			if (input.confirm !== name) throw new Error(`Type ${name} to confirm deletion`);
			const deleted = await this.mcpTarget(name);
			await this.transport.json(path, method('DELETE'));
			return safe({ deleted, verifiedAbsent: (await this.mcpTarget(name)) === null });
		}
		if (action === 'mcp.toggle') {
			if (typeof input.enabled !== 'boolean') throw new Error('enabled is required');
			await this.transport.json(`${path}/enabled`, method('PUT', { enabled: input.enabled }));
			return safe({ target: await this.mcpTarget(name) });
		}
		if (action === 'mcp.test') {
			const health = await this.transport.json(`${path}/test`, body(undefined));
			return safe({ health, target: await this.mcpTarget(name) });
		}
		const auth = await this.transport.json<{
			flow_id?: unknown;
			status?: unknown;
			authorization_url?: unknown;
		}>(`${path}/auth`, body(undefined));
		if (typeof auth.flow_id !== 'string') throw new Error('Hermes returned an invalid OAuth flow');
		const authorizationUrl = httpUrl(
			{ authorization_url: auth.authorization_url },
			'authorization_url'
		);
		const authorization: HermesOAuthAuthorization = {
			flowId: auth.flow_id,
			status: auth.status,
			expiresInSeconds: 900,
			action: { type: 'open', url: authorizationUrl }
		};
		return { authorization };
	}

	private async mcpTarget(name: string) {
		const result = await this.transport.json<{ servers?: Array<Record<string, unknown>> }>(
			'/api/mcp/servers'
		);
		return (result.servers ?? []).find((server) => server.name === name) ?? null;
	}

	private async model(input: Input) {
		const provider = required(input, 'provider', 128);
		const model = required(input, 'model', 256);
		const result = await this.transport.json<{
			confirm_required?: boolean;
			confirm_message?: string;
		}>(
			'/api/model/set',
			body({
				scope: 'main',
				provider,
				model,
				confirm_expensive_model: input.confirmExpensive === true
			})
		);
		if (result.confirm_required) return safe({ confirmationRequired: result.confirm_message });
		const info = await this.transport.json<Record<string, unknown>>('/api/model/info');
		return safe({ target: { provider: info.provider, model: info.model } });
	}
}
