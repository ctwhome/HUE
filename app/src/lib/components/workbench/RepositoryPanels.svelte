<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, ChevronRight, Minus, Plus, RefreshCw, Sparkles } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { api } from './api';

	type Repository = {
		isRepository: boolean;
		repositoryPath?: string;
		repositories?: Array<{ path: string }>;
		branch: string | null;
		changes: Array<{ path: string; index: string; worktree: string; fileUrl: string | null }>;
		worktrees: Array<{ path: string; branch: string | null; head: string }>;
		remotes: Array<{ name: string; webUrl: string | null }>;
	};
	type GitHubItem = { number: number; title: string; url: string };
	type GitHubItems = { issues: GitHubItem[]; pullRequests: GitHubItem[] };
	type CommitModelsResponse = {
		options?: {
			providers?: Array<{
				slug: string;
				name: string;
				authenticated: boolean;
				models: string[];
			}>;
		};
	};

	let {
		projectId,
		onbranch,
		onopenfile,
		onchanges
	}: {
		projectId: string;
		onbranch: (branch: string | null) => void;
		onopenfile: (path: string) => void;
		onchanges: (count: number) => void;
	} = $props();
	let repository = $state<Repository | null>(null);
	let repositoryLoading = $state(false);
	let repositoryError = $state('');
	let repositoryBusy = $state(false);
	let commitMessageGenerating = $state(false);
	let repositoryMessage = $state('');
	let selectedRepository = $state('');
	let githubItems = $state<GitHubItems | null>(null);
	let githubError = $state('');
	let commitMessage = $state('');
	let worktreesOpen = $state(true);
	let commitModel = $state('openai-codex:gpt-5.6-luna');
	let commitModels = $state([
		{ value: 'openai-codex:gpt-5.6-luna', label: 'Codex · GPT-5.6 Luna' }
	]);
	let mounted = false;
	let repositoryRequestGeneration = 0;
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	async function loadRepository() {
		const request = ++repositoryRequestGeneration;
		repositoryLoading = true;
		repositoryError = '';
		try {
			const query = selectedRepository
				? `?repository=${encodeURIComponent(selectedRepository)}`
				: '';
			const result = await api<Repository>(`/api/projects/${projectId}/repository${query}`);
			if (!mounted || request !== repositoryRequestGeneration) return;
			repository = result;
			selectedRepository = result.repositoryPath ?? selectedRepository;
			githubItems = null;
			onbranch(result.branch);
			onchanges(result.changes.length);
			if (isGitHubRepository(result)) void loadGitHubItems();
		} catch (cause) {
			if (!mounted || request !== repositoryRequestGeneration) return;
			repositoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (mounted && request === repositoryRequestGeneration) repositoryLoading = false;
		}
	}
	function isGitHubRepository(result = repository) {
		return result?.remotes.some(
			(remote) =>
				remote.name === 'origin' &&
				remote.webUrl &&
				new URL(remote.webUrl).hostname === 'github.com'
		);
	}
	async function loadGitHubItems() {
		githubError = '';
		try {
			const params = new URLSearchParams({ view: 'github' });
			if (selectedRepository) params.set('repository', selectedRepository);
			githubItems = await api<GitHubItems>(`/api/projects/${projectId}/repository?${params}`);
		} catch (cause) {
			githubError = cause instanceof Error ? cause.message : String(cause);
		}
	}
	function refreshRepository() {
		void loadRepository();
	}
	function repositoryLinks() {
		const url = repository?.remotes.find((remote) => remote.webUrl)?.webUrl;
		if (!url) return [];
		return [
			{ label: 'Repository', url },
			...(new URL(url).hostname === 'github.com'
				? [
						{ label: 'Pull requests', url: `${url}/pulls` },
						{ label: 'Issues', url: `${url}/issues` }
					]
				: [])
		];
	}
	const stagedChanges = () =>
		repository?.changes.filter(({ index }) => index !== ' ' && index !== '?') ?? [];
	const unstagedChanges = () =>
		repository?.changes.filter(({ index, worktree }) => index === '?' || worktree !== ' ') ?? [];
	function openValidated(change: Repository['changes'][number]) {
		if (change.fileUrl) onopenfile(change.fileUrl);
	}
	async function mutateRepository(operation: Record<string, string>) {
		if (repositoryBusy) return false;
		repositoryBusy = true;
		repositoryError = repositoryMessage = '';
		try {
			repository = await api<Repository>(`/api/projects/${projectId}/repository`, {
				method: 'POST',
				body: JSON.stringify({ ...operation, repository: selectedRepository })
			});
			onchanges(repository.changes.length);
			repositoryMessage =
				operation.action === 'commit'
					? 'Committed'
					: operation.action === 'push'
						? 'Pushed'
						: 'Git status updated';
			if (operation.action === 'commit') commitMessage = '';
			return true;
		} catch (cause) {
			repositoryError = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			repositoryBusy = false;
		}
	}
	async function commitAndPush() {
		if (await mutateRepository({ action: 'commit', message: commitMessage }))
			await mutateRepository({ action: 'push' });
	}
	async function generateCommitMessage() {
		if (commitMessageGenerating || !stagedChanges().length) return;
		commitMessageGenerating = true;
		repositoryError = repositoryMessage = '';
		try {
			const separator = commitModel.indexOf(':');
			const result = await api<{ message: string }>(`/api/projects/${projectId}/repository`, {
				method: 'POST',
				body: JSON.stringify({
					action: 'generateCommitMessage',
					repository: selectedRepository,
					provider: commitModel.slice(0, separator),
					model: commitModel.slice(separator + 1)
				})
			});
			commitMessage = result.message;
			repositoryMessage = 'Drafted by Hermes';
		} catch (cause) {
			repositoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			commitMessageGenerating = false;
		}
	}
	async function loadCommitModels() {
		try {
			const result = await api<CommitModelsResponse>('/api/hermes/admin?view=models');
			const available = (result.options?.providers ?? []).flatMap((provider) =>
				provider.authenticated
					? provider.models.map((model) => ({
							value: `${provider.slug}:${model}`,
							label: `${provider.name} · ${model}`
						}))
					: []
			);
			if (available.length) commitModels = available;
		} catch {
			// The default remains available when Hermes model discovery is offline.
		}
	}
	function toggleWorktrees() {
		worktreesOpen = !worktreesOpen;
		localStorage.setItem(`hue:project-tools:${projectId}:worktrees-open`, String(worktreesOpen));
	}

	onMount(() => {
		mounted = true;
		commitModel = localStorage.getItem('hue:commit-message-model') || commitModel;
		worktreesOpen =
			localStorage.getItem(`hue:project-tools:${projectId}:worktrees-open`) !== 'false';
		void loadRepository();
		void loadCommitModels();
		return () => {
			mounted = false;
			repositoryRequestGeneration += 1;
		};
	});
</script>

<article class={`${panel} repository-panel`} aria-label="Git status">
	<header
		class="flex min-h-11 items-center justify-between gap-2 border-b border-border bg-muted/40 px-2.5 py-2"
	>
		<div>
			<strong class="block text-xs">Git</strong><span
				class="block text-[0.68rem] text-muted-foreground"
				>{repository?.branch ?? 'Repository'}</span
			>
		</div>
		{#if (repository?.repositories?.length ?? 0) > 1}<select
				class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs max-[700px]:h-11"
				aria-label="Repository"
				bind:value={selectedRepository}
				disabled={repositoryBusy || repositoryLoading}
				onchange={() => void loadRepository()}
			>
				{#each repository?.repositories ?? [] as item}<option value={item.path}
						>{item.path === '.' ? 'Project root' : item.path}</option
					>{/each}
			</select>{/if}
		<div class="git-header-actions flex gap-1.5">
			<Button
				variant="outline"
				size="sm"
				title="Push branch"
				disabled={repositoryBusy || !repository?.isRepository}
				onclick={() => mutateRepository({ action: 'push' })}>Push</Button
			><Button
				variant="outline"
				size="icon"
				class="size-8"
				title="Refresh Git status"
				aria-label="Refresh Git status"
				disabled={repositoryBusy}
				onclick={refreshRepository}><RefreshCw size={15} aria-hidden="true" /></Button
			>
		</div>
	</header>
	<div class="repository-content min-h-0 flex-1 overflow-auto p-2">
		{#if repositoryLoading}<p class="muted text-xs text-muted-foreground" role="status">
				Reading repository…
			</p>{/if}
		{#if repositoryError}<p class="panel-error text-xs text-destructive" role="alert">
				{repositoryError}
			</p>{/if}
		{#if repository && !repository.isRepository}<div
				class="panel-empty grid min-h-32 place-content-center gap-1 text-center text-xs text-muted-foreground"
			>
				<strong class="text-foreground">Git not detected</strong><span
					>This project is still available to Hermes.</span
				>
			</div>
		{:else if repository?.isRepository}
			<nav class="repository-links flex flex-wrap gap-1 pb-2" aria-label="Repository options">
				{#each repositoryLinks() as link}<a
						class="rounded-md border border-border px-2 py-1.5 text-[0.68rem]"
						href={link.url}
						target="_blank"
						rel="noopener noreferrer"
						title={`Open ${link.label}`}>{link.label}</a
					>{/each}
			</nav>
			{#if isGitHubRepository()}
				<div class="grid grid-cols-2 gap-2 border-y border-border py-2">
					<section class="min-w-0" aria-label="GitHub issues">
						<strong class="px-1 text-xs">Issues</strong>
						<ul class="mt-1 grid list-none gap-0.5 p-0">
							{#each githubItems?.issues ?? [] as item}<li>
									<a
										class="block overflow-hidden rounded-md px-1.5 py-1 text-xs text-ellipsis whitespace-nowrap hover:bg-muted hover:underline"
										href={item.url}
										target="_blank"
										rel="noopener noreferrer"
										title={`Open issue #${item.number}: ${item.title}`}
										>#{item.number} {item.title}</a
									>
								</li>{/each}
						</ul>
						{#if githubItems && !githubItems.issues.length}<small class="px-1 text-muted-foreground"
								>No open issues</small
							>{/if}
					</section>
					<section class="min-w-0" aria-label="GitHub pull requests">
						<strong class="px-1 text-xs">Pull requests</strong>
						<ul class="mt-1 grid list-none gap-0.5 p-0">
							{#each githubItems?.pullRequests ?? [] as item}<li>
									<a
										class="block overflow-hidden rounded-md px-1.5 py-1 text-xs text-ellipsis whitespace-nowrap hover:bg-muted hover:underline"
										href={item.url}
										target="_blank"
										rel="noopener noreferrer"
										title={`Open pull request #${item.number}: ${item.title}`}
										>#{item.number} {item.title}</a
									>
								</li>{/each}
						</ul>
						{#if githubItems && !githubItems.pullRequests.length}<small
								class="px-1 text-muted-foreground">No open pull requests</small
							>{/if}
					</section>
				</div>
				{#if githubError}<p class="px-1 pt-2 text-xs text-destructive" role="alert">
						{githubError}
					</p>{/if}
			{/if}
			<section class="git-section mt-2" aria-label="Staged changes">
				<header class="flex min-h-8 items-center gap-2 px-1">
					<strong class="text-xs">Staged changes</strong><span class="text-xs text-muted-foreground"
						>{stagedChanges().length}</span
					>{#if stagedChanges().length}<button
							class="ml-auto text-[0.68rem] text-sky-400"
							title="Unstage all changes"
							disabled={repositoryBusy}
							onclick={() => mutateRepository({ action: 'unstageAll' })}>Unstage all</button
						>{/if}
				</header>
				<ul class="change-list grid list-none gap-0.5 p-0">
					{#each stagedChanges() as change}<li
							class="grid grid-cols-[22px_18px_minmax(0,1fr)] items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
						>
							<button
								class="grid size-6 place-items-center"
								title={`Unstage ${change.path}`}
								aria-label={`Unstage ${change.path}`}
								disabled={repositoryBusy}
								onclick={() => mutateRepository({ action: 'unstage', path: change.path })}
								><Minus size={14} aria-hidden="true" /></button
							><code class="text-amber-300">{change.index}</code>{#if change.fileUrl}<button
									class="overflow-hidden text-left text-ellipsis whitespace-nowrap hover:underline"
									title={`Open ${change.path}`}
									onclick={() => openValidated(change)}>{change.path}</button
								>{:else}<span class="overflow-hidden text-ellipsis whitespace-nowrap"
									>{change.path}</span
								>{/if}
						</li>{/each}
				</ul>
			</section>
			<section class="git-section mt-2" aria-label="Changes">
				<header class="flex min-h-8 items-center gap-2 px-1">
					<strong class="text-xs">Changes</strong><span class="text-xs text-muted-foreground"
						>{unstagedChanges().length}</span
					>{#if unstagedChanges().length}<button
							class="ml-auto text-[0.68rem] text-sky-400"
							title="Stage all changes"
							disabled={repositoryBusy}
							onclick={() => mutateRepository({ action: 'stageAll' })}>Stage all</button
						>{/if}
				</header>
				<ul class="change-list grid list-none gap-0.5 p-0">
					{#each unstagedChanges() as change}<li
							class="grid grid-cols-[22px_18px_minmax(0,1fr)] items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
						>
							<button
								class="grid size-6 place-items-center"
								title={`Stage ${change.path}`}
								aria-label={`Stage ${change.path}`}
								disabled={repositoryBusy}
								onclick={() => mutateRepository({ action: 'stage', path: change.path })}
								><Plus size={14} aria-hidden="true" /></button
							><code class="text-amber-300">{change.worktree}</code>{#if change.fileUrl}<button
									class="overflow-hidden text-left text-ellipsis whitespace-nowrap hover:underline"
									title={`Open ${change.path}`}
									onclick={() => openValidated(change)}>{change.path}</button
								>{:else}<span class="overflow-hidden text-ellipsis whitespace-nowrap"
									>{change.path}</span
								>{/if}
						</li>{/each}
				</ul>
			</section>
			{#if !repository.changes.length}<div
					class="panel-empty compact grid min-h-24 place-content-center text-xs text-muted-foreground"
				>
					<strong class="text-foreground">Working tree clean</strong>
				</div>{/if}
		{/if}
	</div>
	<form
		class="git-commit grid gap-2 border-t border-border bg-card p-2.5"
		onsubmit={(event) => {
			event.preventDefault();
			void mutateRepository({ action: 'commit', message: commitMessage });
		}}
	>
		<div class="flex items-center gap-2">
			<strong class="text-xs">Commit</strong><span
				class="text-[0.68rem] text-muted-foreground"
				class:ml-auto={!stagedChanges().length}
				>{stagedChanges().length
					? `${stagedChanges().length} staged`
					: 'Stage files to commit'}</span
			>
			{#if stagedChanges().length}<Button
					variant="outline"
					size="icon"
					class="size-8"
					type="button"
					aria-label="Generate commit message with Hermes"
					title="Generate with Hermes using the selected model"
					disabled={repositoryBusy || commitMessageGenerating}
					onclick={generateCommitMessage}
					>{#if commitMessageGenerating}<RefreshCw
							size={15}
							class="animate-spin"
							aria-hidden="true"
						/>{:else}<Sparkles size={15} aria-hidden="true" />{/if}</Button
				>{/if}
		</div>
		<select
			class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
			aria-label="Commit message model"
			bind:value={commitModel}
			onchange={() => localStorage.setItem('hue:commit-message-model', commitModel)}
		>
			{#each commitModels as option}<option value={option.value}>{option.label}</option>{/each}
		</select>
		<Input
			class="h-8 text-xs"
			bind:value={commitMessage}
			aria-label="Commit message"
			placeholder="Commit message"
		/>
		<div class="flex items-center justify-end gap-2">
			{#if repositoryMessage}<small class="mr-auto text-muted-foreground" role="status"
					>{repositoryMessage}</small
				>{/if}<Button
				variant="outline"
				size="sm"
				type="submit"
				title="Commit staged changes"
				disabled={repositoryBusy || !commitMessage.trim() || !stagedChanges().length}>Commit</Button
			><Button
				variant="outline"
				size="sm"
				type="button"
				title="Commit and push staged changes"
				disabled={repositoryBusy || !commitMessage.trim() || !stagedChanges().length}
				onclick={commitAndPush}>Commit &amp; push</Button
			>
		</div>
	</form>
</article>

<article
	class={`${panel} worktrees-panel`}
	style:flex={worktreesOpen ? undefined : '0 0 auto'}
	aria-label="Git worktrees"
>
	<header
		class="flex min-h-11 items-center justify-between border-b border-border bg-muted/40 px-2.5 py-2"
	>
		<strong class="text-xs">Worktrees</strong>
		<div class="flex items-center gap-1">
			<span class="text-[0.68rem] text-muted-foreground">{repository?.worktrees.length ?? 0}</span>
			<button
				type="button"
				class="grid size-8 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring max-[700px]:size-11"
				aria-label={worktreesOpen ? 'Collapse worktrees' : 'Expand worktrees'}
				aria-expanded={worktreesOpen}
				title={worktreesOpen ? 'Collapse worktrees' : 'Expand worktrees'}
				onclick={toggleWorktrees}
			>
				{#if worktreesOpen}<ChevronDown size={16} aria-hidden="true" />{:else}<ChevronRight
						size={16}
						aria-hidden="true"
					/>{/if}
			</button>
		</div>
	</header>
	{#if worktreesOpen}<div class="worktree-list grid min-h-0 content-start gap-1 overflow-auto p-2">
			{#each repository?.worktrees ?? [] as worktree}<article
					class="flex min-w-0 items-start justify-between gap-2 rounded-lg border border-border bg-background/50 p-2"
				>
					<div class="grid min-w-0 gap-1">
						<strong class="text-xs">{worktree.branch ?? 'Detached HEAD'}</strong><code
							class="overflow-hidden text-[0.68rem] text-ellipsis whitespace-nowrap text-muted-foreground"
							>{worktree.path}</code
						>
					</div>
					<small class="font-mono text-primary">{worktree.head.slice(0, 7)}</small>
				</article>{/each}{#if !repositoryLoading && repository?.isRepository && !repository.worktrees.length}<p
					class="muted text-xs text-muted-foreground"
				>
					No linked worktrees.
				</p>{/if}{#if !repositoryLoading && repository && !repository.isRepository}<p
					class="muted text-xs text-muted-foreground"
				>
					Available when this project uses Git.
				</p>{/if}
		</div>{/if}
</article>
