<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ArrowLeft } from 'lucide-svelte';
	import type { GlobalView } from './GlobalNavigation.svelte';
	import AdminResourceView from './hermes/AdminResourceView.svelte';
	import InventoryView from './hermes/InventoryView.svelte';
	import SchedulesView from './hermes/SchedulesView.svelte';
	import SettingsView from './hermes/SettingsView.svelte';
	import SkillsView from './hermes/SkillsView.svelte';
	import type { Command, HermesSection, Job, Skill } from './hermes/types';
	import Button from './ui/Button.svelte';
	import type { DirtyGuard } from './workspace/dirty-guard';

	let {
		view,
		commands,
		dirtyGuard,
		onview,
		oncommand
	}: {
		view: GlobalView;
		commands: Command[];
		dirtyGuard: DirtyGuard;
		onview: (view: GlobalView | null) => void;
		oncommand: (command: Command) => void;
	} = $props();
	let loading = $state(false);
	let error = $state('');
	let notice = $state('');
	let data = $state<Record<string, any>>({});
	let skills = $state<Skill[]>([]);
	let jobs = $state<Job[]>([]);
	let selectedSkill = $state('');
	let selectedSkillEditable = $state(false);
	let selectedSkillProvenance = $state('');
	let skillContent = $state('');
	let originalSkillContent = $state('');
	let skillSaving = $state(false);
	let skillSaved = $state(false);
	let requestGeneration = 0;
	const capabilityNames = ['memoryEditor', 'memoryHistory', 'skillDelete', 'skillLinkedFiles'];
	const runtimeActions = ['runtime.restart-admin', 'runtime.reconnect-acp'];

	const labels: Record<GlobalView, string> = {
		notifications: 'Notifications',
		settings: 'Settings',
		runtime: 'Runtime',
		memory: 'Memory',
		skills: 'Installed skills',
		schedules: 'Scheduled jobs',
		commands: 'Session commands',
		profiles: 'Profiles',
		mcp: 'MCP servers',
		models: 'Providers & models'
	};
	const sections: HermesSection[] = [
		{
			view: 'runtime',
			label: 'Runtime',
			description: 'Versions, compatibility, health, logs, and reconnection.'
		},
		{
			view: 'memory',
			label: 'Memory',
			description: 'Hermes-owned memory status and upstream capabilities.'
		},
		{
			view: 'skills',
			label: 'Skills',
			description: 'Create, validate, edit, and enable supported skills.'
		},
		{
			view: 'schedules',
			label: 'Schedules',
			description: 'Create, run, pause, inspect, and delete jobs.'
		},
		{
			view: 'commands',
			label: 'Commands',
			description: 'Run eligible commands in active Session.'
		},
		{
			view: 'profiles',
			label: 'Profiles',
			description: 'Create, clone, choose next-launch default, inspect, and delete profiles.'
		},
		{
			view: 'mcp',
			label: 'MCP',
			description: 'Configure, authenticate, test, toggle, and inspect tools.'
		},
		{
			view: 'models',
			label: 'Models',
			description: 'Apply Hermes-validated provider/model assignments.'
		}
	];

	async function api<T>(url: string, options?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...options,
			headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
		});
		const body = (await response.json()) as T & { error?: string };
		if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
		return body;
	}

	function normalize(next: GlobalView, result: Record<string, any>) {
		data = result;
		if (next === 'skills') {
			skills = (result.skills ?? []).map((skill: Record<string, any>) => ({
				...skill,
				category: skill.category ?? '',
				source:
					(skill.provenance ?? skill.source) === 'agent'
						? 'custom'
						: (skill.provenance ?? skill.source ?? 'custom'),
				status: (skill.enabled ?? skill.status === 'enabled') ? 'enabled' : 'disabled'
			}));
		}
		if (next === 'schedules') {
			jobs = (result.jobs ?? []).map((job: Record<string, any>) => ({
				...job,
				schedule:
					typeof job.schedule === 'string'
						? job.schedule
						: (job.schedule_display ?? job.schedule?.display ?? job.schedule?.expr ?? ''),
				status: job.status ?? (job.enabled ? 'active' : 'paused'),
				nextRun: job.nextRun ?? job.next_run_at,
				lastRun: job.lastRun ?? job.last_run_at
			}));
		}
	}

	async function load(next: GlobalView) {
		const request = ++requestGeneration;
		error = '';
		notice = '';
		if (next === 'settings' || next === 'commands') return;
		loading = true;
		try {
			const result = await api<Record<string, any>>(
				next === 'runtime'
					? '/api/hermes'
					: next === 'mcp'
						? '/api/hermes/mcp'
						: `/api/hermes?view=${next}`
			);
			if (request !== requestGeneration) return;
			normalize(next, result);
		} catch (cause) {
			if (request === requestGeneration)
				error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (request === requestGeneration) loading = false;
		}
	}

	$effect(() => void load(view));

	function hasUnsavedSkill() {
		return Boolean(selectedSkill && skillContent !== originalSkillContent);
	}

	function discardSkillChanges() {
		skillContent = originalSkillContent;
		selectedSkill = '';
		selectedSkillEditable = false;
		skillSaved = false;
	}

	const dirtySource = untrack(() => dirtyGuard.register(discardSkillChanges));
	$effect(() => dirtySource.setDirty(hasUnsavedSkill()));
	onDestroy(() => dirtySource.unregister());

	function guarded(action: () => void) {
		if (!dirtyGuard.block(action)) action();
	}

	function navigate(next: GlobalView | null) {
		guarded(() => {
			discardSkillChanges();
			onview(next);
		});
	}

	async function openSkill(name: string) {
		loading = true;
		error = '';
		skillSaved = false;
		try {
			const skill = await api<{
				name: string;
				content: string;
				provenance: string;
				editable: boolean;
			}>(`/api/hermes/skills/${encodeURIComponent(name)}`);
			selectedSkill = skill.name;
			selectedSkillEditable = skill.editable;
			selectedSkillProvenance = skill.provenance;
			skillContent = skill.content;
			originalSkillContent = skill.content;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function saveSkill() {
		if (!selectedSkill || !selectedSkillEditable) return;
		skillSaving = true;
		skillSaved = false;
		error = '';
		try {
			const skill = await api<{ content: string }>(
				`/api/hermes/skills/${encodeURIComponent(selectedSkill)}`,
				{ method: 'PUT', body: JSON.stringify({ content: skillContent }) }
			);
			skillContent = skill.content;
			originalSkillContent = skill.content;
			skillSaved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			skillSaving = false;
		}
	}

	function closeSkill() {
		guarded(discardSkillChanges);
	}

	function actionNotice(result: Record<string, any>, target: string) {
		if (result.confirmationRequired) return `Confirmation required: ${result.confirmationRequired}`;
		if (result.unsupported) return `Unsupported: ${String(result.unsupported)}`;
		if (result.verifiedAbsent === false) return `Could not verify absence: ${target}`;
		if (
			result.health?.ok === false ||
			result.auth?.ok === false ||
			result.authorization?.status === 'error'
		) {
			return `Health or authentication failed: ${target}`;
		}
		if (result.reconciliation) return `Reconciliation required: ${String(result.reconciliation)}`;
		if (result.authorization?.action?.type === 'open') return 'Authorization action ready';
		if (result.verifiedAbsent === true) return `Verified absent by readback: ${target}`;
		if (result.target !== undefined) return `Verified success by readback: ${target}`;
		return `Reconciliation required: ${target || 'mutation'} returned no verification state`;
	}

	async function deleteSkill(name: string) {
		if (window.prompt(`Type ${name} to confirm deletion`) !== name) return;
		loading = true;
		error = '';
		try {
			const result = await api<Record<string, any>>(
				`/api/hermes/skills/${encodeURIComponent(name)}`,
				{ method: 'DELETE', body: JSON.stringify({ confirm: name }) }
			);
			await load('skills');
			notice = actionNotice(result, name);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	function confirmDestructive(action: string, target: string) {
		if (!action.endsWith('.delete')) return true;
		return window.prompt(`Type ${target} to confirm deletion`) === target;
	}

	async function action(action: string, input: Record<string, unknown>) {
		const target = String(input.name ?? input.id ?? '');
		if (!confirmDestructive(action, target)) return;
		if (
			action.startsWith('runtime.') &&
			!window.confirm(
				`Confirm ${action === 'runtime.restart-admin' ? 'Hermes admin restart' : 'Hermes ACP reconnect'}?`
			)
		)
			return;
		loading = true;
		error = '';
		notice = '';
		try {
			const result = await api<Record<string, any>>('/api/hermes/admin', {
				method: 'POST',
				body: JSON.stringify({
					action,
					input: { ...input, ...(action.endsWith('.delete') ? { confirm: target } : {}) }
				})
			});
			data.lastAction = result;
			await load(view);
			notice = actionNotice(result, target || action);
			return result;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}
</script>

<section
	class="global-panel fixed inset-y-0 right-0 left-14 z-20 flex min-w-0 flex-col bg-background max-[700px]:top-14 max-[700px]:left-0"
	aria-label={view === 'settings' ? 'Settings' : 'Hermes management'}
	data-capabilities={capabilityNames.join(',')}
	data-runtime-actions={runtimeActions.join(',')}
>
	<header
		class="flex min-h-[76px] items-center justify-between border-b border-border px-6 py-3.5 max-[700px]:min-h-[62px] max-[700px]:px-3.5"
	>
		<div>
			<small class="text-muted-foreground">{view === 'settings' ? 'HUE' : 'Hermes'}</small>
			<h1 class="mt-1 font-semibold">{labels[view]}</h1>
		</div>
		<Button
			variant="outline"
			size="icon"
			aria-label="Back to workspace"
			title="Back to workspace"
			onclick={() => navigate(null)}><ArrowLeft size={18} aria-hidden="true" /></Button
		>
	</header>
	<nav
		class="global-panel-tabs flex gap-1.5 overflow-x-auto border-b border-border px-6 py-2.5"
		aria-label="Hermes sections"
	>
		<Button
			variant={view === 'settings' ? 'secondary' : 'ghost'}
			title="Settings overview"
			onclick={() => navigate('settings')}>Overview</Button
		>
		{#each sections as section}<Button
				variant={view === section.view ? 'secondary' : 'ghost'}
				title={section.label === 'MCP' ? 'MCP servers' : section.label}
				onclick={() => navigate(section.view)}>{section.label}</Button
			>{/each}
	</nav>
	<label class="mobile-settings-selector border-b border-border p-2.5">
		<span class="sr-only">Settings section</span>
		<select
			class="min-h-11 w-full rounded-md border border-border bg-card px-3"
			aria-label="Settings section"
			value={view}
			onchange={(event) => navigate((event.currentTarget as HTMLSelectElement).value as GlobalView)}
		>
			<option value="settings">Overview</option>
			{#each sections as section}<option value={section.view}>{section.label}</option>{/each}
		</select>
	</label>
	<div
		class="global-panel-content flex-1 overflow-auto px-[clamp(18px,5vw,70px)] py-7 max-[700px]:p-3"
	>
		{#if loading && view !== 'commands'}<p
				class="muted text-sm text-muted-foreground"
				role="status"
			>
				Loading Hermes {view}…
			</p>{/if}
		{#if error}<p class="directory-error mb-3 text-sm text-destructive" role="alert">
				{error}
			</p>{/if}
		{#if notice}<p class="mb-3 text-sm text-emerald-300" role="status">{notice}</p>{/if}
		{#if view === 'settings'}
			<SettingsView {sections} onview={navigate} />
		{:else if view === 'skills'}
			<SkillsView
				{skills}
				{selectedSkill}
				{selectedSkillEditable}
				{selectedSkillProvenance}
				bind:skillContent
				{skillSaving}
				{skillSaved}
				onopen={openSkill}
				onclose={closeSkill}
				onsave={saveSkill}
				ondelete={deleteSkill}
				onaction={action}
				capabilities={data.capabilities ?? {}}
			/>
		{:else if view === 'schedules'}
			<SchedulesView {jobs} deliveryTargets={data.deliveryTargets ?? []} onaction={action} />
		{:else if view === 'commands'}
			<InventoryView {view} {commands} profiles={[]} servers={[]} {oncommand} />
		{:else}
			<AdminResourceView {view} {data} onaction={action} />
		{/if}
	</div>
</section>
