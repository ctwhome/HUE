<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import type { GlobalView } from '../GlobalNavigation.svelte';

	let {
		view,
		data,
		onaction,
		onbackup
	}: {
		view: GlobalView;
		data: Record<string, any>;
		onaction: (
			action: string,
			input: Record<string, unknown>
		) => Promise<Record<string, any> | undefined>;
		onbackup: () => Promise<void>;
	} = $props();
	let name = $state('');
	let cloneFrom = $state('');
	let url = $state('');
	let command = $state('');
	let bearerToken = $state('');
	let authMode = $state<'none' | 'header' | 'oauth'>('none');
	let modelProvider = $state('');
	let modelName = $state('');
	let result = $state<Record<string, any> | null>(null);
	let errorLogsOpen = $state(false);
	const card = 'rounded-xl border border-border bg-card p-4';
	const errorLogsStorageKey = 'hue:hermes:error-logs-open';
	onMount(() => (errorLogsOpen = localStorage.getItem(errorLogsStorageKey) === 'true'));
	const profiles = () => (data.profiles ?? []) as Array<Record<string, any>>;
	const servers = () => (data.servers ?? []) as Array<Record<string, any>>;
	const providers = () => (data.options?.providers ?? []) as Array<Record<string, any>>;
	const statusLabel = (value: unknown) =>
		value === true ? 'ready' : value === false ? 'blocked' : String(value ?? 'unknown');

	async function act(action: string, input: Record<string, unknown>) {
		const response = await onaction(action, input);
		bearerToken = '';
		return response;
	}

	async function inspectMcp(serverName: string, action: 'mcp.test' | 'mcp.auth') {
		result = null;
		result = (await act(action, { name: serverName })) ?? null;
	}

	async function updateAuthorization(action: 'mcp.auth.status' | 'mcp.auth.cancel') {
		const flowId = result?.authorization?.flowId;
		if (!flowId) return;
		result = (await act(action, { flowId })) ?? null;
	}
</script>

{#if view === 'memory'}
	<div class="grid gap-3">
		<article class={card}>
			<h2 class="font-semibold">Memory documents</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Built-in MEMORY.md and USER.md remain Hermes-owned.
			</p>
			<p class="mt-2 text-sm">
				Status: {data.status?.active ?? 'builtin'} · MEMORY.md {data.status?.builtin_files
					?.memory ?? 0} bytes · USER.md {data.status?.builtin_files?.user ?? 0} bytes
			</p>
		</article>
		{#each data.unsupported ?? [] as message}<article class={`${card} border-[var(--warning)]`}>
				<strong>Unavailable upstream</strong>
				<p class="mt-1 text-sm text-muted-foreground">{message}</p>
			</article>{/each}
	</div>
{:else if view === 'runtime'}
	<div class="grid gap-3">
		<div class="inventory-grid grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
			<article class={card}>
				<small class="text-muted-foreground">HUE database</small>
				<strong class="mt-1 block">{data.diagnostics?.database?.status ?? 'not checked'}</strong>
				{#if data.diagnostics?.database?.action}<p class="mt-1 text-sm text-muted-foreground">
						{data.diagnostics.database.action}
					</p>{/if}
			</article>
			{#if data.agent}<article class={card}>
					<small class="text-muted-foreground">Agent</small><strong class="mt-1 block"
						>{data.agent.name} {data.agent.version}</strong
					>
				</article>{/if}
			{#each [['Hermes admin service', data.administration?.health?.ok ? 'ready' : 'unavailable'], ['Dashboard auth gate', data.administration?.health?.auth_required ? 'required' : 'isolated session token'], ['Gateway state', data.administration?.status?.gateway_running ? 'running' : 'stopped'], ['Nous provider/bootstrap session', data.administration?.status?.nous_session_valid ? 'authenticated' : 'not authenticated'], ['Configuration', data.administration?.status?.config_version === data.administration?.status?.latest_config_version ? 'current' : 'update needed'], ['Hermes ACP', data.agent ? 'ready' : 'idle']] as item}<article
					class={card}
				>
					<small class="text-muted-foreground">{item[0]}</small><strong class="mt-1 block"
						>{statusLabel(item[1])}</strong
					>
				</article>{/each}
		</div>
		<article class={`${card} flex flex-wrap items-center gap-2`}>
			<div class="mr-auto">
				<strong>Runtime control</strong>
				<p class="text-sm text-muted-foreground">
					Hermes {data.administration?.health?.version ?? data.agent?.version ?? 'unknown'} · HUE 0.0.1
					· ACP v{data.protocolVersion ?? 1}
				</p>
			</div>
			<Button variant="outline" onclick={() => act('runtime.restart-admin', { confirm: 'restart' })}
				>Restart admin</Button
			>
			<Button
				variant="outline"
				onclick={() => act('runtime.reconnect-acp', { confirm: 'reconnect' })}>Reconnect ACP</Button
			>
		</article>
		<article class={`${card} flex flex-wrap items-center gap-3`}>
			<div class="mr-auto">
				<strong>HUE data backup</strong>
				<p class="text-sm text-muted-foreground">
					Includes HUE-owned SQLite state and referenced image files. Hermes data is not included.
				</p>
			</div>
			<Button variant="outline" onclick={onbackup}>Create validated backup</Button>
			{#if data.backup?.path}<p class="w-full text-sm break-all" role="status">
					Validated database backup: {data.backup.path}
				</p>{/if}
			{#if data.backup?.attachmentsPath}<p class="w-full text-sm break-all" role="status">
					Validated image backup: {data.backup.attachmentsPath}
				</p>{/if}
			<p class="w-full text-sm text-muted-foreground">
				Offline restore: stop HUE and preserve the current data. Replace the database with the
				validated database backup and, when an image backup is shown, copy it to the restored
				database path plus <code>.attachments</code> before restarting. Live restore is intentionally
				unavailable.
			</p>
		</article>
		<article class={card}>
			<strong>Update availability</strong>
			<p class="mt-1 text-sm">{data.administration?.update?.message ?? 'Not checked'}</p>
		</article>
		<details
			class={card}
			open={errorLogsOpen}
			ontoggle={(event) => {
				errorLogsOpen = event.currentTarget.open;
				localStorage.setItem(errorLogsStorageKey, String(errorLogsOpen));
			}}
		>
			<summary>Redacted error logs</summary>
			<pre class="mt-2 max-h-80 overflow-auto text-xs">{(
					data.administration?.logs?.lines ?? []
				).join('\n') || 'No errors.'}</pre>
		</details>
	</div>
{:else if view === 'profiles'}
	<div class="grid gap-3">
		<article class={card}>
			<strong>Profile launch scope</strong>
			<p class="mt-1 text-sm text-muted-foreground">
				Next-launch default: {data.active?.active ?? 'default'} · Running admin profile: {data
					.active?.current ?? 'default'} · Running ACP profile: {data.runningAcpProfile ??
					'default'}. Running admin and ACP processes keep profiles constructed at launch.
			</p>
		</article>
		<form
			class={`${card} grid grid-cols-[1fr_1fr_auto] gap-2 max-[700px]:grid-cols-1`}
			onsubmit={(event) => {
				event.preventDefault();
				void act('profile.create', { name, cloneFrom });
			}}
		>
			<Input bind:value={name} aria-label="Profile name" placeholder="New profile name" required />
			<select
				class="min-h-11 rounded-md border border-input bg-background px-3"
				bind:value={cloneFrom}
				aria-label="Clone profile"
			>
				<option value="">Create fresh</option>{#each profiles() as profile}<option
						value={profile.name}>Clone {profile.name}</option
					>{/each}
			</select>
			<Button type="submit">Create profile</Button>
		</form>
		<div class="inventory-list grid gap-2">
			{#each profiles() as profile}<article class={`${card} flex flex-wrap items-center gap-2`}>
					<div class="mr-auto">
						<strong>{profile.display_name || profile.name}</strong>
						<p class="text-sm text-muted-foreground">
							{profile.provider ?? 'provider unset'} · {profile.model ?? 'model unset'} · {profile.skill_count ??
								0} skills · Gateway {profile.gateway_running ? 'running' : 'stopped'}
						</p>
					</div>
					{#if data.active?.active !== profile.name}<Button
							variant="outline"
							onclick={() => act('profile.switch', { name: profile.name })}>Use next launch</Button
						>{/if}
					{#if !profile.is_default}<Button
							variant="destructive"
							onclick={() => act('profile.delete', { name: profile.name, confirm: profile.name })}
							>Delete</Button
						>{/if}
				</article>{/each}
		</div>
	</div>
{:else if view === 'mcp'}
	<div class="grid gap-3">
		<form
			class={`${card} grid grid-cols-2 gap-2 max-[700px]:grid-cols-1`}
			onsubmit={(event) => {
				event.preventDefault();
				void act('mcp.create', { name, url, command, auth: authMode, bearerToken });
			}}
		>
			<Input bind:value={name} aria-label="MCP server name" placeholder="Server name" required />
			<Input
				bind:value={url}
				aria-label="MCP server URL"
				placeholder="HTTPS URL (or command below)"
			/>
			<Input bind:value={command} aria-label="MCP server command" placeholder="stdio command" />
			<select
				class="min-h-11 rounded-md border border-input bg-background px-3"
				bind:value={authMode}
				aria-label="MCP authentication"
			>
				<option value="none">No authentication</option>
				<option value="header">Bearer header</option>
				<option value="oauth">OAuth</option>
			</select>
			<Input
				bind:value={bearerToken}
				type="password"
				autocomplete="new-password"
				aria-label="MCP bearer token"
				placeholder="Bearer token (write-only)"
				disabled={authMode !== 'header'}
			/>
			<Button type="submit">Add MCP server</Button>
		</form>
		<div class="inventory-list grid gap-2">
			{#each servers() as server}<article class={`${card} flex flex-wrap items-center gap-2`}>
					<div class="mr-auto">
						<strong>{server.name}</strong>
						<p class="text-sm text-muted-foreground">
							{server.command || server.url || server.transport} · Service {server.enabled
								? 'enabled'
								: 'disabled'} · Auth {server.auth ?? 'none'}
						</p>
					</div>
					<Button
						variant="outline"
						onclick={() => act('mcp.toggle', { name: server.name, enabled: !server.enabled })}
						>{server.enabled ? 'Disable' : 'Enable'}</Button
					>
					<Button variant="outline" onclick={() => inspectMcp(server.name, 'mcp.test')}
						>Test health & tools</Button
					>
					{#if server.auth === 'oauth'}<Button
							variant="outline"
							onclick={() => inspectMcp(server.name, 'mcp.auth')}>Authenticate</Button
						>{/if}
					<Button
						variant="destructive"
						onclick={() => act('mcp.delete', { name: server.name, confirm: server.name })}
						>Delete</Button
					>
				</article>{/each}
		</div>
		{#if result}<pre class={`${card} overflow-auto text-xs`}>{JSON.stringify(
					result,
					null,
					2
				)}</pre>{/if}
		{#if result?.authorization?.action?.type === 'open'}<article
				class={`${card} flex flex-wrap gap-2`}
			>
				<a
					class="inline-flex min-h-11 items-center rounded-md border border-input px-3 text-sm"
					href={result.authorization.action.url}
					target="_blank"
					rel="noopener noreferrer">Open authorization</a
				>
				<Button variant="outline" onclick={() => updateAuthorization('mcp.auth.status')}
					>Check authorization status</Button
				>
				<Button variant="outline" onclick={() => updateAuthorization('mcp.auth.cancel')}
					>Cancel authorization</Button
				>
			</article>{/if}
	</div>
{:else if view === 'models'}
	<form
		class={`${card} grid max-w-2xl gap-3`}
		onsubmit={(event) => {
			event.preventDefault();
			void act('model.set', { provider: modelProvider, model: modelName });
		}}
	>
		<h2 class="font-semibold">Validated provider and model</h2>
		<p class="text-sm text-muted-foreground">
			Stored provider credentials never enter HUE browser payloads.
		</p>
		<label class="grid gap-1 text-sm"
			>Provider<select
				class="min-h-11 rounded-md border border-input bg-background px-3"
				bind:value={modelProvider}
				required
				onchange={() => (modelName = '')}
				><option value="">Choose provider</option>{#each providers() as provider}<option
						value={provider.slug}
						>{provider.name}
						{provider.authenticated ? '· authenticated' : '· setup required'}</option
					>{/each}</select
			></label
		>
		<label class="grid gap-1 text-sm"
			>Model<select
				class="min-h-11 rounded-md border border-input bg-background px-3"
				bind:value={modelName}
				required
				><option value="">Choose model</option
				>{#each providers().find((provider) => provider.slug === modelProvider)?.models ?? [] as model}<option
						value={model}>{model}</option
					>{/each}</select
			></label
		>
		<Button type="submit">Validate and apply</Button>
	</form>
{/if}
