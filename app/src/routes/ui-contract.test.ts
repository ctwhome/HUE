import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('./+page.svelte');
const workspace = read('../lib/components/Workspace.svelte');
const projectRail = read('../lib/components/workspace/ProjectRail.svelte');
const workspacePaths = [
	'../lib/components/Workspace.svelte',
	'../lib/components/workspace/Composer.svelte',
	'../lib/components/workspace/ContextPanel.svelte',
	'../lib/components/workspace/Conversation.svelte',
	'../lib/components/workspace/DirtyGuardDialog.svelte',
	'../lib/components/workspace/MobileNavigation.svelte',
	'../lib/components/workspace/mobile-gesture.ts',
	'../lib/components/workspace/mobile-navigation.ts',
	'../lib/components/workspace/mobile-shell.ts',
	'../lib/components/workspace/dirty-guard.ts',
	'../lib/components/workspace/dirty-navigation.ts',
	'../lib/components/workspace/ProjectRail.svelte',
	'../lib/components/workspace/PromptLibraryDialog.svelte',
	'../lib/components/workspace/SessionHeader.svelte',
	'../lib/components/workspace/SessionManagerDialog.svelte',
	'../lib/components/workspace/SessionManagerOverlay.svelte',
	'../lib/components/workspace/MobileProjectEntry.svelte',
	'../lib/components/workspace/ProjectFoldersEditor.svelte',
	'../lib/components/workspace/message-state.svelte.ts',
	'../lib/components/workspace/navigation.svelte.ts',
	'../lib/components/workspace/navigation-history.ts',
	'../lib/components/workspace/project-management.svelte.ts',
	'../lib/components/workspace/runtime-state.svelte.ts',
	'../lib/components/workspace/session-state.svelte.ts',
	'../lib/components/workspace/transcript-follow.svelte.ts'
];
const workspaceFiles = workspacePaths.map(read);
const page = `${route}\n${workspaceFiles.join('\n')}`;
const contextPanel = read('../lib/components/workspace/ContextPanel.svelte');
const layout = read('./+layout.svelte');
const appStyles = read('../app.css');
const styleFiles = [
	'../styles/theme-base.css',
	'../styles/workspace-forms.css',
	'../styles/conversation-composer.css',
	'../styles/liquid-thinking-orb.css',
	'../styles/mobile-overlays.css',
	'../styles/thinking-task.css',
	'../styles/responsive.css'
].map(read);
const styles = [appStyles, ...styleFiles].join('\n');
const navigation = read('../lib/components/GlobalNavigation.svelte');
const panel = read('../lib/components/HermesPanel.svelte');
const voiceCall = read('../lib/voice/voice-call.svelte.ts');
const hermesViews = [
	'AdminResourceView',
	'InventoryView',
	'PreferencesView',
	'RuntimeView',
	'SchedulesView',
	'SettingsView',
	'SkillsView'
].map((name) => read(`../lib/components/hermes/${name}.svelte`));
const hermes = [panel, ...hermesViews].join('\n');
const workbenchFiles = [
	'../lib/components/ProjectWorkbench.svelte',
	'../lib/components/workbench/BrowserPanel.svelte',
	'../lib/components/workbench/HealthStrip.svelte',
	'../lib/components/workbench/FilesPanel.svelte',
	'../lib/components/workbench/FilePreview.svelte',
	'../lib/components/workbench/FileDialogs.svelte',
	'../lib/components/workbench/file-types.ts',
	'../lib/components/workbench/file-preview-requests.ts',
	'../lib/components/workbench/file-tree.ts',
	'../lib/components/workbench/file-upload.ts',
	'../lib/components/workbench/TerminalPanel.svelte',
	'../lib/components/workbench/RepositoryPanels.svelte',
	'../lib/components/workbench/api.ts'
].map(read);
const workbench = workbenchFiles.join('\n');
const button = read('../lib/components/ui/Button.svelte');
const input = read('../lib/components/ui/Input.svelte');
const textarea = read('../lib/components/ui/Textarea.svelte');
const ui = [page, navigation, panel, workbench].join('\n');
const e2e = read('./workspace.e2e.ts');

test('PWA capture and pin UI keeps create separate from send and uses honest fallback copy', () => {
	const capture = read('../lib/components/pwa/QuickCapture.svelte');
	const install = read('../lib/components/pwa/InstallPinGuidance.svelte');
	expect(workspace).toContain('<QuickCapture');
	expect(page).toContain('<InstallPinGuidance');
	expect(capture).toContain('Create Session');
	expect(capture).not.toContain('sendText');
	expect(capture).toContain('bind:this={composerElement}');
	expect(capture).toContain('min-h-11');
	expect(install).toContain('beforeinstallprompt');
	expect(install).toContain('Copy link');
	expect(install).toMatch(/browser menu/i);
	expect(install).toContain('min-h-11');
});

test('uses Tailwind tokens and local shadcn-style primitives', () => {
	expect(appStyles).toContain("@import 'tailwindcss'");
	expect(styles).toContain('@theme inline');
	expect(styles).toContain('--color-background: var(--background)');
	expect(button).toContain(
		"type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive'"
	);
	expect(input).toContain('focus-visible:ring-2 focus-visible:ring-ring');
	expect(textarea).toContain('focus-visible:ring-2 focus-visible:ring-ring');
	expect(appStyles.split('\n').length).toBeLessThan(20);
	for (const source of styleFiles) expect(source.split('\n').length).toBeLessThan(501);
});

test('keeps major workspace surfaces in focused Svelte components', () => {
	for (const component of ['GlobalNavigation', 'HermesPanel', 'ProjectWorkbench']) {
		expect(workspace).toContain(`<${component}`);
	}
	expect(route.split('\n').length).toBeLessThan(20);
	for (const source of workspaceFiles) expect(source.split('\n').length).toBeLessThan(551);
});

test('workflow fields have accessible names', () => {
	expect(page).toContain('aria-label="Workflow name"');
	expect(page).toContain('aria-label="Workflow prompt"');
});

test('prompt library explains its purpose and empty state', () => {
	expect(page).toContain('Repeat a Hermes task without rewriting its instructions');
	expect(page).toContain('Run creates a new Session');
	expect(page).toContain('No prompts yet');
	expect(page).toContain('Create prompt');
});

test('prompt library opens from the composer instead of occupying session navigation', () => {
	const contextPanel = read('../lib/components/workspace/ContextPanel.svelte');
	const composer = read('../lib/components/workspace/Composer.svelte');
	expect(contextPanel).not.toContain('role="tablist"');
	expect(contextPanel).not.toContain('>Workflows</button');
	expect(composer).toContain('<PromptLibraryDialog');
});

test('long session titles stay inside the row so session actions remain reachable', () => {
	expect(page).toContain('class="session-row relative w-full min-w-0"');
	expect(page).toContain('class="session-row-title flex min-w-0 items-baseline gap-2"');
});

test('new session is a persistent full-width action at the top of the session list', () => {
	const contextPanel = read('../lib/components/workspace/ContextPanel.svelte');
	const action = 'class="new-session-action sticky top-0 z-10 flex min-h-11 w-full';
	expect(contextPanel).toContain(action);
	expect(contextPanel).toContain('<Plus size={18} aria-hidden="true" /> Add new session');
	expect(contextPanel.indexOf(action)).toBeLessThan(
		contextPanel.indexOf('{#each sessions as session')
	);
});

test('project context only uses a compact header in the mobile session drawer', () => {
	const contextPanel = read('../lib/components/workspace/ContextPanel.svelte');
	expect(contextPanel).not.toContain('Session scope');
	expect(styles).toMatch(/\.context-panel > \.project-context-header\s*{[^}]*display: none;/s);
	expect(styles).toMatch(
		/@media \(max-width: 700px\)[\s\S]*\.context-panel > \.project-context-header\s*{[^}]*display: flex;[^}]*min-height: 56px;/
	);
});

test('tooltips use the app-level collision-aware provider', () => {
	expect(layout).toContain("import TooltipProvider from '$lib/components/TooltipProvider.svelte'");
	expect(layout).toContain('<TooltipProvider />');
	expect(styles).toMatch(/\.app-tooltip\s*\{[^}]*position: fixed;[^}]*z-index: 100;/s);
	const tooltip = read('../lib/components/TooltipProvider.svelte');
	expect(tooltip).toContain("trigger.closest('.global-rail')");
	expect(tooltip).toContain('target.right + gap');
});

test('global navigation exposes workspace and Hermes administration', () => {
	expect(navigation).toContain('aria-label="Global navigation"');
	expect(navigation).toContain('href="/docs/"');
	expect(navigation).toContain('aria-label="Open documentation in a new tab"');
	for (const label of [
		'Workspace',
		'Settings',
		'Schedules',
		'Skills',
		'Commands',
		'Profiles',
		'MCP'
	]) {
		expect(navigation).toContain(`aria-label="${label}"`);
	}
	expect(navigation).toContain('aria-label="Inspect Hermes runtime"');
	expect(navigation).toContain('class="global-admin mt-auto');
});

test('Hermes management remains complete and request-race safe', () => {
	for (const section of [
		'Runtime',
		'Memory',
		'Skills',
		'Schedules',
		'Commands',
		'Profiles',
		'MCP',
		'Models'
	]) {
		expect(hermes).toContain(`label: '${section}'`);
	}
	expect(hermes).toContain('requestGeneration');
	expect(hermes).toContain('request !== requestGeneration');
	expect(hermes).toContain('aria-label="Skill content"');
	expect(hermes).toContain('confirmDestructive');
	expect(hermes).toContain('runtime.restart-admin');
	expect(hermes).toContain('runtime.reconnect-acp');
	expect(hermes).toContain('oncommand');
	for (const action of ['Create schedule', 'Run now', 'Run history', 'Pause', 'Resume', 'Delete']) {
		expect(hermes).toContain(action);
	}
	expect(hermes).toContain("window.prompt('Schedule prompt', job.prompt ?? '')");
	expect(hermes).toContain("window.prompt('Cron schedule', job.schedule ?? '')");
	expect(hermes).toContain("window.prompt('Delivery target', job.deliver ?? 'local')");
	for (const capability of ['memoryEditor', 'memoryHistory', 'skillDelete', 'skillLinkedFiles']) {
		expect(hermes).toContain(capability);
	}
	expect(hermes).toContain('dirtyGuard.register(discardSkillChanges)');
	expect(hermes).not.toContain("window.confirm('Discard unsaved skill changes?')");
	expect(hermes).not.toContain("addEventListener('beforeunload'");
	expect(hermes).not.toContain('notice = `Verified ${target || action}`');
	for (const outcome of [
		'Confirmation required',
		'Health or authentication failed',
		'Could not verify absence',
		'Reconciliation required',
		'Unsupported'
	]) {
		expect(hermes).toContain(outcome);
	}
	expect(hermes).toContain('Next-launch default');
	expect(hermes).toContain('Running admin profile');
	expect(hermes).toContain('Running ACP profile');
	expect(hermes).toContain('Use next launch');
	expect(hermes).toContain('Nous provider/bootstrap session');
	expect(hermes).toContain('Dashboard auth gate');
	expect(hermes).toContain('Gateway state');
	expect(hermes).toContain('Open authorization');
	expect(hermes).toContain('Check authorization status');
	expect(hermes).toContain('Cancel authorization');
	expect(hermes).toContain('Read-only');
	expect(hermes).toContain('profile: job.profile');
});

test('preferences expose supported appearance, input, language, voice, usage, and CLI controls', () => {
	const preferences = read('../lib/components/hermes/PreferencesView.svelte');
	for (const label of [
		'Send key',
		'Theme',
		'Density',
		'Language',
		'Voice',
		'Show usage',
		'Show CLI Sessions'
	]) {
		expect(preferences).toContain(label);
	}
	expect(preferences).toContain('hue:preferences');
	expect(preferences).toContain('disabled');
	expect(preferences).toContain('Unsupported: Hermes session origin/source metadata unavailable');
	expect(preferences).not.toContain('bind:checked={showCliSessions}');
	expect(voiceCall).toContain("dataset.voice === 'system'");
	expect(voiceCall).toContain('SpeechSynthesisUtterance');
});

test('project workbench owns browser, terminal, and Git behavior', () => {
	for (const source of workbenchFiles) expect(source.split('\n').length).toBeLessThan(510);
	for (const label of ['Project browser', 'Project terminal', 'Git status', 'Git worktrees']) {
		expect(workbench).toContain(`aria-label="${label}"`);
	}
	expect(workbench).toContain("import { Terminal } from '@xterm/xterm'");
	expect(workbench).toContain('inputSequence: Math.max(item.inputSequence, body.inputSequence)');
	expect(workbench).toContain("action: 'stage'");
	expect(workbench).toContain("action: 'commit'");
	expect(workbench).toContain("action: 'push'");
	expect(workbench).toContain('onDestroy(() =>');
	expect(styles).toContain("grid-template-areas: 'browser repository' 'terminal worktrees'");
});

test('browser workbench keeps Browser and Excalidraw as separate tabs', () => {
	const browserPanel = read('../lib/components/workbench/BrowserPanel.svelte');
	expect(browserPanel).toContain('aria-label="Project browser"');
	expect(browserPanel).toContain('aria-label="Browser and Excalidraw views"');
	expect(browserPanel).toContain('>Browser</button');
	expect(browserPanel).toContain('>Excalidraw</button');
	expect(browserPanel).toContain("import ExcalidrawPanel from './ExcalidrawPanel.svelte'");
	expect(browserPanel).toContain('New browser tab');
	expect(browserPanel).not.toContain('migrateLegacyBrowserTabs');
});

test('Excalidraw tab lazy-loads a real canvas with safe live embeds', () => {
	const excalidrawPanel = read('../lib/components/workbench/ExcalidrawPanel.svelte');
	const canvasAdapter = read('../lib/components/workbench/ExcalidrawBrowserCanvas.tsx');
	expect(excalidrawPanel).toContain('Add desktop');
	expect(excalidrawPanel).toContain('Add mobile');
	expect(excalidrawPanel).toContain("import('./ExcalidrawBrowserCanvas')");
	expect(excalidrawPanel).toContain('afterInitialPaint');
	expect(excalidrawPanel).not.toContain('migrateLegacyBrowserTabs');
	expect(excalidrawPanel).not.toMatch(/^\s*import .*@excalidraw\/excalidraw/m);
	expect(excalidrawPanel).toContain('Sites that block framing');
	expect(excalidrawPanel).toContain('X-Frame-Options');
	expect(excalidrawPanel).toContain('CSP');
	for (const dependency of ['react', 'react-dom/client', '@excalidraw/excalidraw'])
		expect(canvasAdapter).toContain(`import('${dependency}')`);
	expect(canvasAdapter).toContain("import('@excalidraw/excalidraw/index.css')");
	expect(canvasAdapter).toContain('validateEmbeddable');
	expect(canvasAdapter).toContain('renderEmbeddable');
	expect(canvasAdapter).toContain('restore(');
	expect(canvasAdapter).toContain('CaptureUpdateAction.IMMEDIATELY');
	expect(canvasAdapter).toContain('tools: { image: false }');
	expect(canvasAdapter).toContain(
		"sandbox: 'allow-forms allow-modals allow-popups allow-same-origin allow-scripts'"
	);
	expect(canvasAdapter).not.toContain('allow-top-navigation');
	expect(canvasAdapter).not.toContain('allow-downloads');
	expect(canvasAdapter).not.toContain('allow-clipboard');
	expect(styles).toMatch(/\.browser-embed-external\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
	expect(styles).toMatch(/\.browser-frame-note\s*\{[^}]*white-space: normal;/s);
	expect(styles).not.toMatch(/\.browser-frame-note\s*\{[^}]*display: none;/s);
});

test('Project files expose bounded accessible tree, previews, evidence, and guarded mutations', () => {
	for (const label of [
		'Project files',
		'File breadcrumbs',
		'Search Project files',
		'Refresh files',
		'Expand all folders',
		'Collapse all folders',
		'Artifacts and evidence',
		'Upload files',
		'Download file',
		'Save file'
	])
		expect(workbench).toContain(label);
	expect(workbench).toContain("classification: 'source'");
	expect(workbench).toContain('File changed outside HUE');
	expect(workbench).toContain('File moved or deleted');
	expect(workbench).toContain('Concurrency-protected editing and moving unavailable');
	expect(page).toContain('onbeforeunload');
	expect(workbench).toContain('44px');
	expect(workbench).toContain('change.fileUrl');
	expect(workbench).toContain('onopenfile(change.fileUrl)');
});

test('mobile shell keeps drawers and 44px targets', () => {
	expect(styles).toMatch(/@media \(max-width: 700px\)/);
	expect(styles).toContain('min-height: 44px');
	expect(styles).toContain('.project-rail.open');
	expect(styles).toContain('.context-panel.open');
	expect(page).toContain("aria-current={drawer === 'projects' ? 'page' : undefined}");
	expect(page).toContain("aria-current={drawer === 'sessions' ? 'page' : undefined}");
	expect(page).toContain('aria-label="Close Projects"');
	expect(page).toContain('aria-label="Close Sessions"');
	expect(styles).toContain('(pointer: coarse) and (max-height: 500px)');
});

test('mobile chat exposes resilient content, compact context, and auto-growing input contracts', () => {
	expect(styles).toContain('overflow-wrap: anywhere');
	expect(styles).toContain('max-inline-size: 100%');
	expect(page).toContain('function resizeComposer()');
	expect(page).toContain('aria-label="Session details"');
	expect(page).toContain('Delivery status unknown');
	expect(page).toContain('aria-label="Search models"');
	expect(page).toContain('Edit Session');
	expect(page).toContain('Save changes');
});

test('mobile secondary surfaces are self-explanatory and bounded', () => {
	expect(page).toContain('A Workflow is a reusable Hermes prompt scoped to this Project.');
	expect(page).toContain('New workflow');
	expect(page).toContain('Run creates and opens a new Session.');
	expect(panel).toContain('aria-label="Settings section"');
	expect(styles).toContain('.dialog-body');
	expect(styles).toContain('.dialog-footer');
});

test('composer exposes HUE work mode selector and timeline status item hooks', () => {
	const composer = read('../lib/components/workspace/Composer.svelte');
	const dialog = read('../lib/components/workspace/ThinkingDialog.svelte');
	expect(composer).toContain('Work mode');
	expect(composer).toContain('Autonomous');
	expect(composer).toContain('Live');
	expect(dialog).toContain("item.kind === 'status'");
	expect(dialog).toContain('{item.label}');
});

test('clean chat keeps thinking and tasks in responsive composer panels', () => {
	const conversation = read('../lib/components/workspace/Conversation.svelte');
	const composer = read('../lib/components/workspace/Composer.svelte');
	const task = read('../lib/components/workspace/CurrentTask.svelte');
	const dialog = read('../lib/components/workspace/ThinkingDialog.svelte');
	const orb = read('../lib/components/workspace/LiquidThinkingOrb.svelte');
	expect(conversation).toContain('selectTranscriptTimeline');
	expect(conversation).not.toContain('<ThinkingDialog');
	expect(conversation).not.toContain('<LiquidThinkingOrb');
	expect(conversation).not.toContain("item.kind === 'plan'");
	expect(composer).toContain('<ThinkingDialog');
	expect(composer).toContain('class="composer-activity"');
	expect(dialog).toContain('aria-label="Thinking activity"');
	expect(dialog).toContain('{#if busy}<section class="thinking-activity"');
	expect(dialog).toContain('aria-expanded={open}');
	expect(dialog).toContain('animate-spin');
	expect(composer).toContain('<CurrentTask {plan}');
	expect(task).toContain('>Tasks</span>');
	expect(task).toContain('aria-expanded={tasksExpanded}');
	expect(task).toContain('showModal()');
	expect(task).toContain('aria-label="Tasks"');
	expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
	expect(styles).toMatch(/@media \(max-width: 700px\)[\s\S]*\.task-dialog/);
	expect(orb).toContain('Hermes reasoning');
	expect(orb).toContain("import('./liquid-orb-renderer')");
	expect(orb).toContain("canvas.getContext('webgpu')");
	expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-thinking-orb/);
});

test('liquid orb adaptation carries upstream MIT notice', () => {
	const notices = read('../../../THIRD_PARTY_NOTICES.md');
	expect(notices).toContain('LerSent001/orb');
	expect(notices).toContain('Copyright (c) 2026 LerSent001');
	expect(notices).toContain('MIT License');
});

test('project and session controls preserve accessible editing', () => {
	expect(page).toContain('aria-label="Add Hermes Project"');
	expect(page).toContain('aria-label="New session without a project"');
	expect(projectRail).not.toContain('<header class="brand');
	expect(projectRail).toMatch(
		/class="project-row projectless-row[\s\S]*aria-label="New session without a project"/
	);
	expect(page).toContain('aria-label="Project icon image"');
	expect(page).toContain('aria-label="Choose project emoji"');
	expect(page).toContain('aria-label={`Edit ${project.name}`}');
	expect(page).toContain("method: 'PATCH'");
	expect(page).toContain("method: 'DELETE'");
});

test('stale Projects and first run expose direct recovery instead of a broken workbench', () => {
	for (const label of [
		'Manage folders',
		'Archive',
		'Open without Project',
		'Add Project',
		'Start without Project'
	]) {
		expect(page).toContain(label);
	}
	expect(page).toContain('selectedProject && !selectedProject.rootAvailable');
	expect(page).not.toContain('<span>No PTY</span>');
});

test('workbench reports Project, Git, terminal, preview, ACP, and admin health separately', () => {
	for (const label of ['Project', 'Git', 'Terminal', 'Preview', 'Hermes ACP', 'Hermes admin']) {
		expect(workbench).toContain(label);
	}
	expect(workbench).toContain('/api/health?projectId=');
});

test('composer preserves complete-envelope and unknown-delivery controls', () => {
	expect(page).toContain("'Message Hermes… / for commands'");
	expect(page).toContain('aria-label="Send"');
	expect(page).toContain('onretry={messageState.retryPendingMessage}');
	expect(page).toContain('Retry exact message');
	expect(page).toContain("this.setError(body.transcriptError ?? '');");
	expect(page).toContain('popover="auto"');
	expect(page).toContain('role="menuitemradio"');
});

test('chat remains internally scrollable and exposes message actions', () => {
	expect(page).toContain('h-dvh');
	expect(page).toContain('class="transcript min-h-0 flex-1 overflow-auto');
	expect(page).toContain('aria-label="Scroll to latest message"');
	expect(styles).toContain('white-space: pre-wrap');
	for (const label of [
		'Copy message',
		'Edit and resend message',
		'Fork from this message unavailable'
	]) {
		expect(page).toContain(`aria-label="${label}"`);
	}
	expect(page).toContain(
		'Hermes ACP can duplicate a full Session but cannot fork from a selected message'
	);
	expect(page).toContain('navigator.clipboard.writeText(message.text)');
});

test('interface icons use lucide instead of handwritten SVGs', () => {
	expect(ui).not.toContain('<svg');
	for (const icon of [
		'MessageSquare',
		'CalendarDays',
		'Grid2X2',
		'Code2',
		'UserRound',
		'Plus',
		'X',
		'RefreshCw',
		'Send'
	]) {
		expect(ui).toContain(`<${icon}`);
	}
});

test('e2e fixture contains no personal absolute path', () => {
	expect(e2e).not.toContain('/Users/ctw/');
	expect(e2e).toContain('process.cwd()');
});
