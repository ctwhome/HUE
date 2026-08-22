<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import type { GlobalView } from './GlobalNavigation.svelte';
	import InventoryView from './hermes/InventoryView.svelte';
	import RuntimeView from './hermes/RuntimeView.svelte';
	import SchedulesView from './hermes/SchedulesView.svelte';
	import SettingsView from './hermes/SettingsView.svelte';
	import SkillsView from './hermes/SkillsView.svelte';
	import type {
		Command,
		HermesInfo,
		HermesSection,
		Job,
		McpServer,
		Profile,
		Skill
	} from './hermes/types';
	import Button from './ui/Button.svelte';

	let {
		view,
		commands,
		onview
	}: { view: GlobalView; commands: Command[]; onview: (view: GlobalView | null) => void } =
		$props();
	let loading = $state(false);
	let error = $state('');
	let info = $state<HermesInfo | null>(null);
	let skills = $state<Skill[]>([]);
	let jobs = $state<Job[]>([]);
	let profiles = $state<Profile[]>([]);
	let servers = $state<McpServer[]>([]);
	let selectedSkill = $state('');
	let skillContent = $state('');
	let skillSaving = $state(false);
	let skillSaved = $state(false);
	let requestGeneration = 0;

	const labels: Record<GlobalView, string> = {
		settings: 'Settings',
		runtime: 'Runtime',
		skills: 'Installed skills',
		schedules: 'Scheduled jobs',
		commands: 'Session commands',
		profiles: 'Profiles',
		mcp: 'MCP servers'
	};
	const sections: HermesSection[] = [
		{
			view: 'runtime',
			label: 'Runtime',
			description: 'Check the connection and advertised capabilities.'
		},
		{ view: 'skills', label: 'Skills', description: 'Find and maintain installed agent skills.' },
		{
			view: 'schedules',
			label: 'Schedules',
			description: 'Review automated jobs and their run state.'
		},
		{
			view: 'commands',
			label: 'Commands',
			description: 'See commands available in active sessions.'
		},
		{ view: 'profiles', label: 'Profiles', description: 'Compare configured models and gateways.' },
		{ view: 'mcp', label: 'MCP', description: 'Review connected tool servers.' }
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

	async function load(next: GlobalView) {
		const request = ++requestGeneration;
		selectedSkill = '';
		error = '';
		if (next === 'settings' || next === 'commands') return;
		loading = true;
		try {
			const result = await api<
				HermesInfo & { skills?: Skill[]; jobs?: Job[]; profiles?: Profile[]; servers?: McpServer[] }
			>(
				next === 'mcp'
					? '/api/hermes/mcp'
					: `/api/hermes${next === 'runtime' ? '' : `?view=${next}`}`
			);
			if (request !== requestGeneration) return;
			if (next === 'runtime') info = result;
			if (next === 'skills') skills = result.skills ?? [];
			if (next === 'schedules') jobs = result.jobs ?? [];
			if (next === 'profiles') profiles = result.profiles ?? [];
			if (next === 'mcp') servers = result.servers ?? [];
		} catch (cause) {
			if (request === requestGeneration)
				error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (request === requestGeneration) loading = false;
		}
	}

	$effect(() => {
		void load(view);
	});

	async function openSkill(name: string) {
		loading = true;
		error = '';
		skillSaved = false;
		try {
			const skill = await api<{ name: string; content: string }>(
				`/api/hermes/skills/${encodeURIComponent(name)}`
			);
			selectedSkill = skill.name;
			skillContent = skill.content;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}

	async function saveSkill() {
		if (!selectedSkill) return;
		skillSaving = true;
		skillSaved = false;
		error = '';
		try {
			const skill = await api<{ content: string }>(
				`/api/hermes/skills/${encodeURIComponent(selectedSkill)}`,
				{ method: 'PUT', body: JSON.stringify({ content: skillContent }) }
			);
			skillContent = skill.content;
			skillSaved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			skillSaving = false;
		}
	}

	function closeSkill() {
		selectedSkill = '';
		skillSaved = false;
	}
</script>

<section
	class="global-panel fixed inset-y-0 right-0 left-14 z-20 flex min-w-0 flex-col bg-background max-[700px]:top-14 max-[700px]:left-0"
	aria-label={view === 'settings' ? 'Settings' : 'Hermes management'}
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
			onclick={() => onview(null)}><ArrowLeft size={18} aria-hidden="true" /></Button
		>
	</header>
	<nav
		class="global-panel-tabs flex gap-1.5 overflow-x-auto border-b border-border px-6 py-2.5 max-[700px]:px-2.5"
		aria-label="Hermes sections"
	>
		<Button
			variant={view === 'settings' ? 'secondary' : 'ghost'}
			title="Settings overview"
			onclick={() => onview('settings')}>Overview</Button
		>
		{#each sections as section}
			<Button
				variant={view === section.view ? 'secondary' : 'ghost'}
				title={section.label === 'MCP' ? 'MCP servers' : section.label}
				onclick={() => onview(section.view)}>{section.label}</Button
			>
		{/each}
	</nav>
	<div
		class="global-panel-content flex-1 overflow-auto px-[clamp(18px,5vw,70px)] py-7 max-[700px]:p-3"
	>
		{#if loading && view !== 'commands'}
			<p class="muted text-sm text-muted-foreground" role="status">Loading Hermes {view}…</p>
		{:else if error}
			<p class="directory-error text-sm text-destructive" role="alert">{error}</p>
		{:else if view === 'settings'}
			<SettingsView {sections} {onview} />
		{:else if view === 'runtime' && info}
			<RuntimeView {info} />
		{:else if view === 'skills'}
			<SkillsView
				{skills}
				{selectedSkill}
				bind:skillContent
				{skillSaving}
				{skillSaved}
				onopen={openSkill}
				onclose={closeSkill}
				onsave={saveSkill}
			/>
		{:else if view === 'schedules'}
			<SchedulesView {jobs} />
		{:else if view === 'commands' || view === 'profiles' || view === 'mcp'}
			<InventoryView {view} {commands} {profiles} {servers} />
		{/if}
	</div>
</section>
