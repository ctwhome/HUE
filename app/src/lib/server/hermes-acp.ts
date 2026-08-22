import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import {
	DeliveryUncertainError,
	type PromptRuntime,
	type PlanEntry,
	type ClarifyField,
	type InteractionReply,
	type InteractionRequest,
	type SubagentChild,
	type SubagentTree,
	type ToolCall
} from './message-dispatcher';
import type { ImageAttachment } from '$lib/message-content';
import { redactPersistedValue } from './redaction';

export type HermesSession = {
	sessionId: string;
	cwd: string;
	title?: string | null;
	updatedAt?: string | null;
};

export type HermesTranscriptMessage = {
	role: 'user' | 'assistant';
	text: string;
	images?: ImageAttachment[];
};

type HermesModelState = {
	currentModelId: string;
	availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
};

export type HermesSessionState = {
	profile: string;
	clarify?: HermesClarifyCapability;
	models?: HermesModelState | null;
	modes?: acp.SessionModeState | null;
	usage?: { used: number; size: number };
};

export type HermesRuntimeInfo = {
	profile: string;
	protocolVersion?: number;
	agent?: { name: string; version: string };
	capabilities?: Record<string, unknown>;
	clarify?: HermesClarifyCapability;
};

type HermesClarifyCapability = {
	status: 'unsupported' | 'available';
	reason?: string;
};

type HermesSessionResponse = {
	sessionId?: string;
	models?: HermesModelState | null;
	modes?: acp.SessionModeState | null;
};

export const redactToolPayload = redactPersistedValue;

function toolError(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const error = (value as Record<string, unknown>).error;
	return typeof error === 'string' && error ? error : undefined;
}

export function normalizeToolCallUpdate(
	update: Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
	previous?: ToolCall,
	now = Date.now()
): ToolCall {
	const startedAt = previous?.startedAt ?? now;
	const status = update.status ?? previous?.status ?? 'pending';
	const displayContent = toolText(update) || undefined;
	const rawResult =
		update.rawOutput !== undefined
			? redactToolPayload(update.rawOutput)
			: update.sessionUpdate === 'tool_call_update' && displayContent
				? redactToolPayload(displayContent)
				: previous?.result;
	const terminal = status === 'completed' || status === 'failed';
	const completedAt = terminal ? (previous?.completedAt ?? now) : undefined;
	return {
		id: update.toolCallId,
		name: update.name ?? previous?.name ?? 'tool',
		title: update.title ?? previous?.title ?? update.name ?? 'Tool call',
		kind: update.kind ?? previous?.kind ?? 'other',
		status,
		...(update.rawInput !== undefined || (update.sessionUpdate === 'tool_call' && displayContent)
			? { args: redactToolPayload(update.rawInput ?? displayContent) }
			: previous?.args !== undefined
				? { args: previous.args }
				: {}),
		...(rawResult !== undefined ? { result: rawResult } : {}),
		...(status === 'failed' && toolError(rawResult) ? { error: toolError(rawResult) } : {}),
		startedAt,
		...(completedAt !== undefined
			? { completedAt, durationMs: Math.max(0, completedAt - startedAt) }
			: {})
	};
}

function enumOptions(value: unknown): Array<{ value: string; label: string }> | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const schema = value as {
		enum?: unknown[];
		oneOf?: Array<{ const?: unknown; title?: unknown }>;
		anyOf?: Array<{ const?: unknown; title?: unknown }>;
	};
	const titled = schema.oneOf ?? schema.anyOf;
	if (Array.isArray(titled)) {
		return titled.flatMap((option) =>
			typeof option.const === 'string'
				? [{ value: option.const, label: String(option.title ?? option.const) }]
				: []
		);
	}
	return Array.isArray(schema.enum)
		? schema.enum.flatMap((option) =>
				typeof option === 'string' ? [{ value: option, label: option }] : []
			)
		: undefined;
}

function clarifyFields(schema: acp.ElicitationSchema): ClarifyField[] {
	const required = new Set(schema.required ?? []);
	const fields: ClarifyField[] = [];
	for (const [name, property] of Object.entries(schema.properties ?? {})) {
		if (property.type === 'string') {
			const options = enumOptions(property);
			fields.push({
				name,
				label: String(property.title ?? name),
				control: options?.length ? ('single' as const) : ('text' as const),
				required: required.has(name),
				...(options?.length ? { options } : {})
			});
			continue;
		}
		if (property.type === 'array') {
			const options = enumOptions(property.items);
			if (options?.length) {
				fields.push({
					name,
					label: String(property.title ?? name),
					control: 'multi' as const,
					required: required.has(name),
					options
				});
			}
		}
	}
	return fields;
}

function toolText(update: acp.SessionUpdate): string {
	if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update')
		return '';
	return (update.content ?? [])
		.flatMap((item) =>
			item.type === 'content' && item.content.type === 'text' ? [item.content.text] : []
		)
		.join('\n');
}

function startedChildren(
	update: Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call' }>
): SubagentChild[] {
	const input = update.rawInput as
		| { tasks?: Array<{ goal?: unknown; role?: unknown }>; goal?: unknown; role?: unknown }
		| undefined;
	const tasks = input?.tasks?.length ? input.tasks : input?.goal ? [input] : null;
	if (tasks) {
		return tasks.map((task, index) => ({
			index,
			goal: String(task.goal ?? `Task ${index + 1}`),
			...(task.role ? { role: String(task.role) } : {}),
			status: update.status ?? 'in_progress'
		}));
	}
	const text = toolText(update);
	const numbered = text.split('\n').flatMap((line) => {
		const match = line.match(/^(\d+)\.\s+(.+?)(?:\s+\(([^()]*)\))?$/);
		return match
			? [
					{
						index: Number(match[1]) - 1,
						goal: match[2],
						...(match[3] ? { role: match[3] } : {}),
						status: update.status ?? 'in_progress'
					}
				]
			: [];
	});
	if (numbered.length) return numbered;
	const single = text.match(/^Delegating task:\n([\s\S]+)$/);
	return single
		? [{ index: 0, goal: single[1].trim(), status: update.status ?? 'in_progress' }]
		: [];
}

function completedChildren(text: string, previous: SubagentTree): SubagentChild[] {
	const failure = text.match(/^Delegation failed:\s*([\s\S]+)$/);
	if (failure) {
		return previous.children.map((child) => ({
			...child,
			status: 'failed',
			result: failure[1].trim()
		}));
	}
	const lines = text.split('\n');
	const results = new Map<number, { status: string; role?: string; result: string[] }>();
	let current: { status: string; role?: string; result: string[] } | null = null;
	for (const line of lines) {
		const match = line.match(/^[^\w]*Task (\d+):\s+([\w-]+)(?:\s+\(([^)]*)\))?$/);
		if (match) {
			const role = match[3]?.match(/(?:^|,\s*)role=([^,]+)/)?.[1];
			current = { status: match[2], ...(role ? { role } : {}), result: [] };
			results.set(Number(match[1]) - 1, current);
		} else if (current && line.trim() && !line.startsWith('Tools:')) {
			current.result.push(line.replace(/^Error:\s*/, ''));
		}
	}
	return previous.children.map((child) => {
		const result = results.get(child.index);
		if (!result) return child;
		const textResult = result.result.join('\n').trim();
		return {
			...child,
			...(result.role ? { role: result.role } : {}),
			status: result.status,
			...(textResult ? { result: textResult } : {})
		};
	});
}

export function normalizeDelegateTaskUpdate(
	update: acp.SessionUpdate,
	previous?: SubagentTree
): SubagentTree | null {
	if (update.sessionUpdate === 'tool_call') {
		if (update.name !== 'delegate_task' && !update.title.startsWith('delegate')) return null;
		const children = startedChildren(update);
		return {
			id: update.toolCallId,
			title: `${children.length} subagent${children.length === 1 ? '' : 's'}`,
			status: update.status ?? 'in_progress',
			children
		};
	}
	if (update.sessionUpdate !== 'tool_call_update' || !previous) return null;
	return {
		...previous,
		status: update.status ?? previous.status,
		children: completedChildren(toolText(update), previous)
	};
}

type HermesACPOptions = {
	command?: string;
	profile?: string;
	env?: NodeJS.ProcessEnv;
	onDiagnostic?: (message: string) => void;
};

export function isolatedHermesEnvironment(
	base: NodeJS.ProcessEnv,
	hermesHome: string
): NodeJS.ProcessEnv {
	return Object.fromEntries([
		...['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'].flatMap((name) =>
			base[name] ? [[name, base[name] as string]] : []
		),
		['HOME', hermesHome],
		['HERMES_HOME', hermesHome]
	]);
}

export class HermesACP implements PromptRuntime {
	private readonly command: string;
	private readonly profile: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly onDiagnostic?: (message: string) => void;
	private child: ChildProcessWithoutNullStreams | null = null;
	private connection: acp.ClientConnection | null = null;
	private starting: Promise<void> | null = null;
	private closing = false;
	private unavailable = false;
	private readonly updateHandlers = new Map<string, Set<(update: acp.SessionUpdate) => void>>();
	private readonly interactionHandlers = new Map<
		string,
		(request: InteractionRequest) => Promise<InteractionReply>
	>();
	private readonly availableCommands = new Map<string, acp.AvailableCommand[]>();
	private readonly commandWaiters = new Map<string, Set<() => void>>();
	private readonly sessionStates = new Map<string, HermesSessionState>();
	private readonly stateWaiters = new Map<string, Set<() => void>>();
	private runtimeInfo: HermesRuntimeInfo;

	constructor(options: HermesACPOptions = {}) {
		this.command = options.command ?? 'hermes';
		this.profile = options.profile ?? 'default';
		this.env = options.env ?? process.env;
		this.runtimeInfo = { profile: this.profile };
		this.onDiagnostic = options.onDiagnostic;
	}

	async start(): Promise<void> {
		if (this.connection && !this.connection.signal.aborted) return;
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
		const args = this.profile === 'default' ? ['acp'] : ['--profile', this.profile, 'acp'];
		const child = spawn(this.command, args, {
			env: this.env,
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
			.onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
				this.handlePermission(params)
			)
			.onRequest(acp.methods.client.elicitation.create, ({ params }) =>
				this.handleElicitation(params)
			)
			.onNotification(acp.methods.client.session.update, ({ params }) => {
				this.dispatchUpdate(params.sessionId, params.update);
			});
		const connection = app.connect(stream);
		this.connection = connection;

		child.once('exit', (code, signal) => {
			if (this.child === child) this.child = null;
			if (this.connection === connection) this.connection = null;
			this.clearRuntimeState();
			if (!this.closing) {
				this.unavailable = true;
				const reason = `Hermes ACP exited unexpectedly (code=${String(code)}, signal=${String(signal)})`;
				this.onDiagnostic?.(reason);
				connection.close(new Error(reason));
			}
		});

		try {
			const initialized = await connection.agent.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: { elicitation: { form: {} } },
				clientInfo: { name: 'hue-workspace', version: '0.1.0' }
			});
			this.captureInitialization(initialized);
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

	healthStatus(): 'idle' | 'ready' | 'unavailable' {
		if (this.runtimeInfo.protocolVersion === acp.PROTOCOL_VERSION) return 'ready';
		return this.unavailable ? 'unavailable' : 'idle';
	}

	private captureInitialization(response: unknown): void {
		const value = response as {
			protocolVersion?: number;
			agentInfo?: { name?: string; version?: string };
			agentCapabilities?: Record<string, unknown>;
		};
		this.runtimeInfo = {
			profile: this.profile,
			...(value.protocolVersion !== undefined ? { protocolVersion: value.protocolVersion } : {}),
			...(value.agentInfo?.name && value.agentInfo.version
				? { agent: { name: value.agentInfo.name, version: value.agentInfo.version } }
				: {}),
			...(value.agentCapabilities ? { capabilities: value.agentCapabilities } : {}),
			clarify: {
				status: 'unsupported',
				reason: 'Hermes ACP has not sent elicitation/create'
			}
		};
	}

	getRuntimeInfo(): HermesRuntimeInfo {
		return this.runtimeInfo;
	}

	private clearRuntimeState(): void {
		this.runtimeInfo = { profile: this.profile };
		this.availableCommands.clear();
		this.sessionStates.clear();
	}

	private async context(): Promise<acp.ClientContext> {
		await this.start();
		if (!this.connection) throw new Error('Hermes ACP did not start');
		return this.connection.agent;
	}

	private requestRaw<Response>(context: acp.ClientContext, method: string, params: unknown) {
		return (
			context as unknown as {
				sendRequest: (method: string, params: unknown) => Promise<Response>;
			}
		).sendRequest(method, params);
	}

	async createSession(cwd: string): Promise<HermesSession> {
		const context = await this.context();
		const response = await this.requestRaw<HermesSessionResponse>(
			context,
			acp.methods.agent.session.new,
			{
				cwd,
				mcpServers: []
			}
		);
		if (!response.sessionId) throw new Error('Hermes did not return a Session id');
		this.captureSessionResponse(response.sessionId, response);
		await this.waitForAvailableCommands(response.sessionId);
		await this.waitForSessionState(response.sessionId);
		return { sessionId: response.sessionId, cwd };
	}

	async forkSession(cwd: string, sessionId: string): Promise<HermesSession> {
		const context = await this.context();
		const response = await this.requestRaw<HermesSessionResponse>(
			context,
			acp.methods.agent.session.fork,
			{ cwd, sessionId, mcpServers: [] }
		);
		if (!response.sessionId) throw new Error('Hermes did not return a forked Session id');
		this.captureSessionResponse(response.sessionId, response);
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
			const response = await this.requestRaw<HermesSessionResponse | null>(
				context,
				acp.methods.agent.session.load,
				{
					cwd,
					sessionId,
					mcpServers: []
				}
			);
			if (!response) throw new Error(`Hermes Session ${sessionId} was not found`);
			this.captureSessionResponse(sessionId, response);
			await this.waitForSessionState(sessionId);
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
			if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'image') {
				transcript.push({ role: 'assistant', text: '', images: [this.image(update.content)] });
			}
		});
		try {
			const response = await this.requestRaw<HermesSessionResponse | null>(
				context,
				acp.methods.agent.session.load,
				{
					cwd,
					sessionId,
					mcpServers: []
				}
			);
			if (!response) throw new Error(`Hermes Session ${sessionId} was not found`);
			this.captureSessionResponse(sessionId, response);
			await this.waitForAvailableCommands(sessionId);
			await this.waitForSessionState(sessionId);
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
		onImage?: (image: ImageAttachment) => void;
		onThought?: (text: string) => void;
		onTool?: (update: ToolCall) => void;
		onPlan?: (entries: PlanEntry[]) => void;
		onInteraction?: (request: InteractionRequest) => Promise<InteractionReply>;
		onSubagent?: (update: SubagentTree) => void;
	}): Promise<void> {
		const context = await this.context();
		if (input.onInteraction) this.interactionHandlers.set(input.sessionId, input.onInteraction);
		const delegates = new Map<string, SubagentTree>();
		const tools = new Map<string, ToolCall>();
		const unsubscribe = this.subscribe(input.sessionId, (update) => {
			if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
				input.onChunk(update.content.text);
			}
			if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'image') {
				input.onImage?.(this.image(update.content));
			}
			if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
				input.onThought?.(update.content.text);
			}
			if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
				const normalized = normalizeToolCallUpdate(update, tools.get(update.toolCallId));
				tools.set(normalized.id, normalized);
				input.onTool?.(normalized);
			}
			if (update.sessionUpdate === 'plan') input.onPlan?.(update.entries);
			if (!input.onSubagent) return;
			const id =
				update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update'
					? update.toolCallId
					: '';
			const normalized = normalizeDelegateTaskUpdate(update, delegates.get(id));
			if (normalized) {
				delegates.set(normalized.id, normalized);
				input.onSubagent(normalized);
			}
		});
		try {
			const response = (await context.request(acp.methods.agent.session.prompt, {
				sessionId: input.sessionId,
				prompt: [
					...(input.text.trim() ? [{ type: 'text' as const, text: input.text }] : []),
					...input.images.map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType }))
				]
			})) as acp.PromptResponse;
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
			if (this.interactionHandlers.get(input.sessionId) === input.onInteraction) {
				this.interactionHandlers.delete(input.sessionId);
			}
		}
	}

	private async handlePermission(
		request: acp.RequestPermissionRequest
	): Promise<acp.RequestPermissionResponse> {
		const handler = this.interactionHandlers.get(request.sessionId);
		if (!handler) return { outcome: { outcome: 'cancelled' } };
		const toolCall = normalizeToolCallUpdate(
			{ sessionUpdate: 'tool_call_update', ...request.toolCall },
			undefined
		);
		const response = await handler({
			kind: 'permission',
			id: request.toolCall.toolCallId,
			sessionId: request.sessionId,
			toolCall,
			options: request.options
		});
		return 'outcome' in response
			? (response as acp.RequestPermissionResponse)
			: { outcome: { outcome: 'cancelled' } };
	}

	private async handleElicitation(
		request: acp.CreateElicitationRequest
	): Promise<acp.CreateElicitationResponse> {
		this.runtimeInfo = { ...this.runtimeInfo, clarify: { status: 'available' } };
		for (const [sessionId, state] of this.sessionStates) {
			this.sessionStates.set(sessionId, { ...state, clarify: { status: 'available' } });
		}
		if (!acp.CreateElicitationRequest.isForm(request) || !('sessionId' in request)) {
			return { action: 'cancel' };
		}
		const handler = this.interactionHandlers.get(request.sessionId);
		if (!handler) return { action: 'cancel' };
		const fields = clarifyFields(request.requestedSchema);
		if (!fields.length) return { action: 'cancel' };
		const response = await handler({
			kind: 'clarify',
			id: `clarify-${crypto.randomUUID()}`,
			sessionId: request.sessionId,
			message: request.message,
			fields
		});
		return 'action' in response
			? (response as acp.CreateElicitationResponse)
			: { action: 'cancel' };
	}

	private image(content: Extract<acp.ContentBlock, { type: 'image' }>): ImageAttachment {
		return { name: 'Hermes image', mimeType: content.mimeType, data: content.data };
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
		if (update.sessionUpdate === 'usage_update') {
			this.sessionStates.set(sessionId, {
				...this.getSessionState(sessionId),
				usage: { used: update.used, size: update.size }
			});
			for (const resolve of this.stateWaiters.get(sessionId) ?? []) resolve();
			this.stateWaiters.delete(sessionId);
		}
		if (update.sessionUpdate === 'current_mode_update') {
			const current = this.getSessionState(sessionId);
			if (current.modes) {
				this.sessionStates.set(sessionId, {
					...current,
					modes: { ...current.modes, currentModeId: update.currentModeId }
				});
			}
		}
		for (const handler of this.updateHandlers.get(sessionId) ?? []) handler(update);
	}

	getAvailableCommands(sessionId: string): acp.AvailableCommand[] {
		return this.availableCommands.get(sessionId) ?? [];
	}

	private captureSessionResponse(sessionId: string, response: HermesSessionResponse): void {
		this.sessionStates.set(sessionId, {
			...this.getSessionState(sessionId),
			...(response.models !== undefined ? { models: response.models } : {}),
			...(response.modes !== undefined ? { modes: response.modes } : {})
		});
	}

	getSessionState(sessionId: string): HermesSessionState {
		return {
			profile: this.profile,
			...(this.runtimeInfo.clarify ? { clarify: this.runtimeInfo.clarify } : {}),
			...(this.sessionStates.get(sessionId) ?? {})
		};
	}

	async setModel(sessionId: string, modelId: string): Promise<HermesSessionState> {
		const context = await this.context();
		await this.requestRaw(context, 'session/set_model', { sessionId, modelId });
		const current = this.getSessionState(sessionId);
		if (current.models) {
			this.sessionStates.set(sessionId, {
				...current,
				models: { ...current.models, currentModelId: modelId }
			});
		}
		return this.getSessionState(sessionId);
	}

	async setMode(sessionId: string, modeId: string): Promise<HermesSessionState> {
		const context = await this.context();
		await context.request(acp.methods.agent.session.setMode, { sessionId, modeId });
		const current = this.getSessionState(sessionId);
		if (current.modes) {
			this.sessionStates.set(sessionId, {
				...current,
				modes: { ...current.modes, currentModeId: modeId }
			});
		}
		return this.getSessionState(sessionId);
	}

	async cancelSession(sessionId: string): Promise<void> {
		const context = await this.context();
		await context.request(acp.methods.agent.session.cancel, { sessionId });
	}

	private async waitForSessionState(sessionId: string): Promise<void> {
		if (this.sessionStates.get(sessionId)?.usage) return;
		await new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout>;
			const finish = () => {
				clearTimeout(timer);
				const waiters = this.stateWaiters.get(sessionId);
				waiters?.delete(finish);
				if (!waiters?.size) this.stateWaiters.delete(sessionId);
				resolve();
			};
			timer = setTimeout(finish, 250);
			const waiters = this.stateWaiters.get(sessionId) ?? new Set();
			waiters.add(finish);
			this.stateWaiters.set(sessionId, waiters);
		});
	}

	private async waitForAvailableCommands(sessionId: string): Promise<void> {
		if (this.availableCommands.has(sessionId)) return;
		await new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout>;
			const finish = () => {
				clearTimeout(timer);
				const waiters = this.commandWaiters.get(sessionId);
				waiters?.delete(finish);
				if (!waiters?.size) this.commandWaiters.delete(sessionId);
				resolve();
			};
			timer = setTimeout(finish, 250);
			const waiters = this.commandWaiters.get(sessionId) ?? new Set();
			waiters.add(finish);
			this.commandWaiters.set(sessionId, waiters);
		});
	}

	async close(): Promise<void> {
		this.closing = true;
		this.unavailable = false;
		const connection = this.connection;
		const child = this.child;
		this.connection = null;
		this.child = null;
		this.updateHandlers.clear();
		this.clearRuntimeState();
		for (const waiters of this.stateWaiters.values()) for (const resolve of waiters) resolve();
		this.stateWaiters.clear();
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
