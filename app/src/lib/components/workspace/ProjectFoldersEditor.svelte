<script lang="ts">
	import Folder from '~icons/lucide/folder';
	import FolderPlus from '~icons/lucide/folder-plus';
	import Star from '~icons/lucide/star';
	import Trash2 from '~icons/lucide/trash-2';
	import type { Project } from './types';

	let {
		project,
		saving,
		onadd,
		onsetprimary,
		onremove,
		onlabel
	}: {
		project: Project | null;
		saving: boolean;
		onadd: (project: Project) => void;
		onsetprimary: (project: Project, path: string) => void;
		onremove: (project: Project, path: string) => void;
		onlabel: (project: Project, path: string, label: string) => void;
	} = $props();
</script>

<section class="mt-5 grid gap-2" aria-labelledby="project-folders-title">
	<div class="flex items-center justify-between gap-2">
		<h3 id="project-folders-title">Folders</h3>
		<button
			class="min-h-11"
			disabled={saving || !project}
			onclick={() => project && onadd(project)}
		>
			<FolderPlus width={16} height={16} aria-hidden="true" /> Add folder
		</button>
	</div>
	{#each project?.folders ?? [] as folder (folder.path)}
		<div class="grid gap-2 rounded-lg border border-border p-3">
			<div class="flex min-w-0 items-center gap-2">
				{#if folder.isPrimary}
					<Star width={16} height={16} fill="currentColor" aria-label="Primary folder" />
				{:else}
					<Folder width={16} height={16} aria-hidden="true" />
				{/if}
				<code class="min-w-0 flex-1 overflow-hidden text-ellipsis">{folder.path}</code>
				{#if !folder.available}<small class="text-[var(--warning)]">Unavailable</small>{/if}
			</div>
			<form
				class="flex flex-wrap gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					const label = String(new FormData(event.currentTarget).get('label') ?? '');
					if (project) onlabel(project, folder.path, label);
				}}
			>
				<label class="min-w-[12rem] flex-1">
					<span class="sr-only">Label for {folder.path}</span>
					<input
						class="min-h-11 w-full"
						name="label"
						value={folder.label ?? ''}
						placeholder="Optional label"
					/>
				</label>
				<button type="submit" class="min-h-11" disabled={saving}>Save label</button>
				<button
					type="button"
					class="min-h-11"
					disabled={saving || folder.isPrimary}
					onclick={() => project && onsetprimary(project, folder.path)}
				>
					<Star width={16} height={16} aria-hidden="true" /> Make primary
				</button>
				<button
					type="button"
					class="min-h-11 text-destructive"
					disabled={saving || folder.isPrimary || (project?.folders.length ?? 0) === 1}
					title={folder.isPrimary
						? 'Choose another primary folder before removing this folder'
						: 'Remove folder'}
					onclick={() => project && onremove(project, folder.path)}
				>
					<Trash2 width={16} height={16} aria-hidden="true" /> Remove
				</button>
			</form>
		</div>
	{/each}
</section>
