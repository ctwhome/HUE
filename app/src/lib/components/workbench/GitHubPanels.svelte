<script lang="ts">
	import ChevronRight from '~icons/lucide/chevron-right';
	import GitHubMark from './GitHubMark.svelte';

	type GitHubItem = { number: number; title: string; url: string };

	let {
		items,
		error,
		links,
		weight = 1
	}: {
		items: {
			issueGroups: Array<{ milestone: string | null; issues: GitHubItem[] }>;
			pullRequests: GitHubItem[];
		} | null;
		error: string;
		links: Array<{ label: string; url: string }>;
		weight?: number;
	} = $props();
	const panel =
		'workbench-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card';
	const repositoryLink = $derived(links.find(({ label }) => label === 'Repository'));
	const repositoryLabel = $derived.by(() => {
		if (!repositoryLink) return 'GitHub';
		return new URL(repositoryLink.url).pathname.replace(/^\//, '') || 'GitHub';
	});
	let open = $state(true);
	function toggleFromHeader(event: MouseEvent | KeyboardEvent) {
		if ((event.target as HTMLElement).closest('a, button')) return;
		if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
		event.preventDefault();
		open = !open;
	}
</script>

<article
	class={`${panel} github-panel`}
	style:grid-area="github"
	style:flex={open ? `${weight} 1 0px` : '0 0 auto'}
	aria-label="GitHub work"
>
	<header
		class="flex min-h-11 cursor-pointer items-center border-b border-border bg-muted/40 px-2.5 py-2"
		role="button"
		tabindex="0"
		aria-expanded={open}
		onclick={(event) => toggleFromHeader(event)}
		onkeydown={(event) => toggleFromHeader(event)}
	>
		{#if repositoryLink}<a
				class="flex min-w-0 items-center gap-2 rounded-md text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				href={repositoryLink.url}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open ${repositoryLabel} on GitHub`}
				title={`Open ${repositoryLabel} on GitHub`}
			>
				<GitHubMark size={17} />
				<span class="truncate">{repositoryLabel}</span>
			</a>{:else}<strong class="flex items-center gap-2 text-xs"
				><GitHubMark size={17} /> GitHub</strong
			>{/if}
		<ChevronRight
			width={16}
			height={16}
			class={`ml-auto ${open ? 'rotate-90' : ''}`}
			aria-hidden="true"
		/>
	</header>
	{#if open}
		<div class="min-h-0 flex-1 overflow-auto p-2">
			<nav class="repository-links flex flex-wrap gap-1 pb-2" aria-label="GitHub options">
				{#each links as link}<a
						class="rounded-md border border-border px-2 py-1.5 text-[0.68rem]"
						href={link.url}
						target="_blank"
						rel="noopener noreferrer"
						title={`Open ${link.label}`}>{link.label}</a
					>{/each}
			</nav>
			<div class="grid gap-2 border-t border-border pt-2">
				<details open class="group min-w-0" aria-label="GitHub issues">
					<summary
						class="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-xs max-[700px]:min-h-11"
					>
						<ChevronRight
							width={14}
							height={14}
							class="shrink-0 group-open:rotate-90"
							aria-hidden="true"
						/>
						<strong>Issues</strong><span class="text-muted-foreground"
							>{items?.issueGroups.reduce((count, group) => count + group.issues.length, 0) ??
								0}</span
						>
					</summary>
					<div class="grid gap-1 pl-2">
						{#each items?.issueGroups ?? [] as group}
							<details open class="group min-w-0 rounded-md border border-border/70">
								<summary
									class="flex min-h-8 cursor-pointer items-center gap-2 px-2 text-xs max-[700px]:min-h-11"
								>
									<ChevronRight
										width={14}
										height={14}
										class="shrink-0 group-open:rotate-90"
										aria-hidden="true"
									/>
									<span
										class="rounded border border-border bg-muted px-1 py-0.5 text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase"
										>Milestone</span
									>
									<strong class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
										>{group.milestone ?? 'No milestone'}</strong
									><span class="text-muted-foreground">{group.issues.length}</span>
								</summary>
								<ul class="grid min-w-0 list-none gap-0.5 p-1 pt-0">
									{#each group.issues as item}<li class="min-w-0">
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
							</details>
						{/each}
						{#if items && !items.issueGroups.length}<small class="px-1 text-muted-foreground"
								>No open issues</small
							>{/if}
					</div>
				</details>
				<details open class="group min-w-0" aria-label="GitHub pull requests">
					<summary
						class="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-xs max-[700px]:min-h-11"
					>
						<ChevronRight
							width={14}
							height={14}
							class="shrink-0 group-open:rotate-90"
							aria-hidden="true"
						/>
						<strong>Pull requests</strong><span class="text-muted-foreground"
							>{items?.pullRequests.length ?? 0}</span
						>
					</summary>
					<ul class="grid min-w-0 list-none gap-0.5 p-0 pl-2">
						{#each items?.pullRequests ?? [] as item}<li class="min-w-0">
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
					{#if items && !items.pullRequests.length}<small class="px-3 text-muted-foreground"
							>No open pull requests</small
						>{/if}
				</details>
			</div>
			{#if error}<p class="px-1 pt-2 text-xs text-destructive" role="alert">{error}</p>{/if}
		</div>
	{/if}
</article>
