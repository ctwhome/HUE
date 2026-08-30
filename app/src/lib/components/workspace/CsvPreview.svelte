<script lang="ts">
	import { parseCsvPreview } from '$lib/csv-preview';

	let { src, name, full = false }: { src: string; name: string; full?: boolean } = $props();
	let rows = $state<string[][]>([]);
	let truncated = $state(false);
	let error = $state('');
	let loading = $state(true);

	$effect(() => {
		const controller = new AbortController();
		rows = [];
		truncated = false;
		error = '';
		loading = true;
		void (async () => {
			try {
				const response = await fetch(src, {
					signal: controller.signal,
					headers: { Range: 'bytes=0-999999' }
				});
				const emptyRange =
					response.status === 416 && response.headers.get('content-range') === 'bytes */0';
				if (!response.ok && !emptyRange) throw new Error(`Preview failed (${response.status})`);
				const text = emptyRange ? '' : await response.text();
				if (controller.signal.aborted) return;
				const contentRange = /bytes \d+-(\d+)\/(\d+)/.exec(
					response.headers.get('content-range') ?? ''
				);
				const preview = parseCsvPreview(text);
				rows = preview.rows;
				truncated =
					preview.truncated ||
					Boolean(contentRange && Number(contentRange[1]) + 1 < Number(contentRange[2]));
			} catch (cause) {
				if (!controller.signal.aborted)
					error = cause instanceof Error ? cause.message : String(cause);
			} finally {
				if (!controller.signal.aborted) loading = false;
			}
		})();
		return () => controller.abort();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class:h-full={full}
	class:max-h-[min(55vh,520px)]={!full}
	class="csv-preview overflow-auto bg-card"
	role="region"
	aria-label={`${name} data`}
	tabindex="0"
>
	{#if error}<p class="p-4 text-sm text-destructive" role="alert">{error}</p>
	{:else if loading}<p class="p-4 text-sm text-muted-foreground">Loading CSV preview…</p>
	{:else if rows.length}<table
			class="w-max min-w-full border-separate border-spacing-0 text-left text-sm"
			aria-label={`Preview of ${name}`}
		>
			<thead class="sticky top-0 z-1 bg-muted">
				<tr
					>{#each rows[0] as cell}<th
							class="border-r border-b border-border px-3 py-2 font-semibold last:border-r-0"
							>{cell}</th
						>{/each}</tr
				>
			</thead>
			<tbody
				>{#each rows.slice(1) as row}<tr
						>{#each row as cell}<td
								class="max-w-80 border-r border-b border-border px-3 py-2 align-top whitespace-pre-wrap last:border-r-0"
								>{cell}</td
							>{/each}</tr
					>{/each}</tbody
			>
		</table>
		{#if truncated}<p class="sticky bottom-0 bg-muted px-3 py-2 text-xs text-muted-foreground">
				Preview limited to 200 rows and 50 columns.
			</p>{/if}
	{:else}<p class="p-4 text-sm text-muted-foreground">CSV file is empty.</p>{/if}
</div>
