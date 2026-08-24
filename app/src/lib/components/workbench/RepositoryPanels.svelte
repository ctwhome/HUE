<script lang="ts">
	import { onMount } from 'svelte';
	import { Minus, Plus, RefreshCw } from 'lucide-svelte';
	import Button from '../ui/Button.svelte';
	import Input from '../ui/Input.svelte';
	import { api } from './api';

	type Repository = {
		isRepository: boolean;
		branch: string | null;
		changes: Array<{ path: string; index: string; worktree: string; fileUrl: string | null }>;
		worktrees: Array<{ path: string; branch: string | null; head: string }>;
		remotes: Array<{ name: string; webUrl: string | null }>;
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
	let repositoryMessage = $state('');
	let commitMessage = $state('');
	let mounted = false;
	let repositoryRequestGeneration = 0;
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';

	async function loadRepository() {
		const request = ++repositoryRequestGeneration;
		repositoryLoading = true;
		repositoryError = '';
		try {
			const result = await api<Repository>(`/api/projects/${projectId}/repository`);
			if (!mounted || request !== repositoryRequestGeneration) return;
			repository = result;
			onbranch(result.branch);
			onchanges(result.changes.length);
		} catch (cause) {
			if (!mounted || request !== repositoryRequestGeneration) return;
			repositoryError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (mounted && request === repositoryRequestGeneration) repositoryLoading = false;
		}
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
				body: JSON.stringify(operation)
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

	onMount(() => {
		mounted = true;
		void loadRepository();
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
				onclick={loadRepository}><RefreshCw size={15} aria-hidden="true" /></Button
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
		<div class="flex items-center justify-between">
			<strong class="text-xs">Commit</strong><span class="text-[0.68rem] text-muted-foreground"
				>{stagedChanges().length
					? `${stagedChanges().length} staged`
					: 'Stage files to commit'}</span
			>
		</div>
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

<article class={`${panel} worktrees-panel`} aria-label="Git worktrees">
	<header
		class="flex min-h-11 items-center justify-between border-b border-border bg-muted/40 px-2.5 py-2"
	>
		<strong class="text-xs">Worktrees</strong><span class="text-[0.68rem] text-muted-foreground"
			>{repository?.worktrees.length ?? 0}</span
		>
	</header>
	<div class="worktree-list grid min-h-0 content-start gap-1 overflow-auto p-2">
		{#each repository?.worktrees ?? [] as worktree}<article
				class="flex min-w-0 items-start justify-between gap-2 rounded-lg border border-border bg-background/50 p-2"
			>
				<div class="grid min-w-0 gap-1">
					<strong class="text-xs">{worktree.branch ?? 'Detached HEAD'}</strong><code
						class="overflow-hidden text-[0.68rem] text-ellipsis whitespace-nowrap text-muted-foreground"
						>{worktree.path}</code
					>
				</div>
				<small class="font-mono text-violet-300">{worktree.head.slice(0, 7)}</small>
			</article>{/each}{#if !repositoryLoading && repository?.isRepository && !repository.worktrees.length}<p
				class="muted text-xs text-muted-foreground"
			>
				No linked worktrees.
			</p>{/if}{#if !repositoryLoading && repository && !repository.isRepository}<p
				class="muted text-xs text-muted-foreground"
			>
				Available when this project uses Git.
			</p>{/if}
	</div>
</article>
