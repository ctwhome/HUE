<script lang="ts">
	import type { Component } from 'svelte';
	import Braces from '~icons/lucide/braces';
	import Database from '~icons/lucide/database';
	import File from '~icons/lucide/file';
	import FileArchive from '~icons/lucide/file-archive';
	import FileAudio from '~icons/lucide/file-audio';
	import FileCode2 from '~icons/lucide/file-code-2';
	import FileImage from '~icons/lucide/file-image';
	import FileSpreadsheet from '~icons/lucide/file-spreadsheet';
	import FileText from '~icons/lucide/file-text';
	import FileType2 from '~icons/lucide/file-type-2';
	import FileVideo from '~icons/lucide/file-video';
	import LockKeyhole from '~icons/lucide/lock-keyhole';
	import Presentation from '~icons/lucide/presentation';
	import Settings2 from '~icons/lucide/settings-2';
	import { fileIconKind, type FileIconKind } from './file-icon';

	let { path }: { path: string } = $props();
	const icons: Record<FileIconKind, Component> = {
		archive: FileArchive,
		audio: FileAudio,
		code: FileCode2,
		config: Settings2,
		database: Database,
		document: FileText,
		file: File,
		image: FileImage,
		lock: LockKeyhole,
		markdown: FileText,
		pdf: FileType2,
		presentation: Presentation,
		spreadsheet: FileSpreadsheet,
		text: FileText,
		video: FileVideo
	};
	let kind = $derived(fileIconKind(path));
	let Icon = $derived(icons[kind] ?? Braces);
</script>

<Icon class={`file-type-icon ${kind}`} width={16} height={16} aria-hidden="true" />
