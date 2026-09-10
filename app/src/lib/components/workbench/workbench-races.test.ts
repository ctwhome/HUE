import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
// Execute the actual component functions without a browser or a duplicate implementation.
const fn = (file: string, name: string) => {
	const match = source(file).match(new RegExp(`\\t(?:async )?function ${name}\\([^]*?\\n\\t}`));
	if (!match) throw new Error(`Missing ${name}`);
	return new Bun.Transpiler({ loader: 'ts' }).transformSync(match[0]);
};
const deferred = () => {
	let resolve!: (value: any) => void;
	const promise = new Promise<any>((done) => (resolve = done));
	return { promise, resolve };
};

test('file save acknowledges A without replacing draft B', async () => {
	const response = deferred();
	const run = new Function(
		'savePreview',
		`
		let preview = {path:'a',version:1}, selectedPath='a', editor='A', loadedContent='',
		busy=false, dirty=true, error='', status='', externalChange=false, projectId='p',selectionGeneration=0;
		const canSavePreview=()=>true, isCurrentSave=()=>true, loadTree=async()=>{},
		applyPreview=(value)=>{preview=value;editor=loadedContent=value.content};
		${fn('FilesPanel.svelte', 'saveFile')}
		return {saveFile, type:(value)=>editor=value, state:()=>({editor,loadedContent,status})};
	`
	)(() => response.promise);
	const saving = run.saveFile();
	run.type('B');
	response.resolve({ path: 'a', version: 2, content: 'A' });
	await saving;
	expect(run.state().editor).toBe('B');
	expect(run.state().loadedContent).toBe('A');
});

test('a passive file check cannot abort an unfinished selection', async () => {
	let starts = 0;
	const run = new Function(
		'previewRequests',
		`
		let preview=null,busy=true,projectId='p',selectedPath='b';
		${fn('FilesPanel.svelte', 'checkSelected')}
		return checkSelected;
	`
	)({
		begin: () => {
			starts++;
			return { result: Promise.resolve(null) };
		}
	});
	await run();
	expect(starts).toBe(0);
});

test.each([true, false])(
	'repository mutations reject mismatched context (loading=%s)',
	async (loading) => {
		let posts = 0;
		const run = new Function(
			'api',
			`
		let repositoryBusy=false,repositoryLoading=${loading},commitMessageGenerating=false,repositoryError='',repositoryMessage='',
		projectId='p',repository={repositoryPath:'a',changes:[]},layout={selectedRepository:'b'},
		commitMessage='',mounted=true,repositoryRequestGeneration=1;
		const onchanges=()=>{},onbranch=()=>{};
		${fn('RepositoryPanels.svelte', 'mutateRepository')}
		return mutateRepository;
	`
		)(async () => {
			posts++;
			return { changes: [] };
		});
		await run({ action: 'stage', path: 'old-file' });
		expect(posts).toBe(0);
	}
);

test('narrow preview and artifact failures have visible states', () => {
	expect(source('FilePreview.svelte')).toContain('Boolean(selectedPath || preview || diffData)');
	const files = source('FilesPanel.svelte');
	expect(files).toContain('treeError');
	expect(files).toContain('artifactsError');
	expect(files).toContain('No artifacts or evidence found');
});

test('discovery errors retain known servers and clean reload is capability gated', async () => {
	const run = new Function(
		'api',
		`
		let discoveringServers=false,discoveryStarted=false,discoveryError='',devServers=[{port:44010}];
		${fn('BrowserPanel.svelte', 'discoverServers')}
		return {discoverServers,state:()=>({devServers,discoveryError})};
	`
	)(async () => {
		throw new Error('offline');
	});
	await run.discoverServers();
	expect(run.state().devServers).toHaveLength(1);
	expect(run.state().discoveryError).toBe('offline');
	expect(source('BrowserPanel.svelte')).toContain(
		'disabled={!nativePreview || !currentBrowserTab?.url}'
	);
});

test('health does not infer readiness from a saved URL', () => {
	const health = source('HealthStrip.svelte');
	expect(health).not.toContain("previewUrl ? ('ready' as const)");
	expect(health).toContain('Refresh health');
});

test('reversed tree searches keep the newest result and busy state', async () => {
	const first = deferred(),
		second = deferred();
	let calls = 0;
	const run = new Function(
		'api',
		`
		let treeGeneration=0,treeController,loading=false,error='',treeError='',query='a',projectId='p',
		entries=[],truncated=false,focusedPath='',selectedPath='',visibleEntries=[],expanded=new Set();
		const restoreTreeFocus=()=>'',checkSelected=async()=>{};
		${fn('FilesPanel.svelte', 'loadTree')}
		return {loadTree,state:()=>({entries,loading})};
	`
	)(() => (++calls === 1 ? first.promise : second.promise));
	const a = run.loadTree(),
		b = run.loadTree();
	second.resolve({ results: ['b'], truncated: false });
	await b;
	first.resolve({ results: ['a'], truncated: false });
	await a;
	expect(run.state()).toEqual({ entries: ['b'], loading: false });
});

test('terminal A-B-A rejects the old A poll even when the tab id matches', async () => {
	const response = deferred();
	const output: string[] = [];
	const run = new Function(
		'api',
		'terminalRenderer',
		`
		let terminalTabs=[{id:'a',terminalId:'t',cursor:0,inputSequence:0}],activeTerminalTabId='a',
		terminalPollGeneration=1,terminalPollController=new AbortController(),terminalClosing=false,
		scopedProjectId='p',terminalError='',terminalPollTimer;
		const activeTerminalTab=()=>terminalTabs[0],startTerminalPolling=()=>{};
		${fn('TerminalPanel.svelte', 'pollTerminal')}
		return {poll:()=>pollTerminal(terminalPollGeneration),switchAwayAndBack:()=>terminalPollGeneration+=2,
		state:()=>terminalTabs[0]};
	`
	)(() => response.promise, { write: (text: string) => output.push(text), reset: () => {} });
	const polling = run.poll();
	run.switchAwayAndBack();
	response.resolve({ output: 'old', cursor: 5, inputSequence: 0, status: 'running' });
	await polling;
	expect(output).toEqual([]);
	expect(run.state().cursor).toBe(0);
});

test('canvas flush rejects failed writes instead of acknowledging success', async () => {
	const text = source('ExcalidrawBrowserCanvas.tsx');
	const flush = text.match(/\tconst flush = \(\) => \{[^]*?\n\t};/)![0];
	const run = new Function(
		'options',
		`
		let saveTimer,latestElements=[],latestAppState={},saveChain=Promise.resolve(),
		acknowledgedScene='',saveGeneration=0,destroyed=false;
		const serializeBrowserScene=()=> '{"elements":[]}',reportDirty=()=>{};
		${flush}
		return flush;
	`
	)({
		onsave: async () => {
			throw new Error('conflict');
		},
		onerror: () => {}
	});
	await expect(run()).rejects.toThrow('conflict');
});

test('canvas stays dirty until acknowledgement and retains edits made during a save', async () => {
	const text = source('ExcalidrawBrowserCanvas.tsx');
	const flush = text.match(/\tconst flush = \(\) => \{[^]*?\n\t};/)![0];
	const response = deferred();
	const run = new Function(
		'options',
		`
		let saveTimer,latestElements=[{text:'A'}],latestAppState={},saveChain=Promise.resolve(),
		acknowledgedScene='',saveGeneration=0,destroyed=false;
		const serializeBrowserScene=(elements)=>JSON.stringify({elements}),reportDirty=()=>{};
		${flush}
		return {flush,type:()=>latestElements=[{text:'B'}],dirty:()=>serializeBrowserScene(latestElements)!==acknowledgedScene};
	`
	)({ onsave: () => response.promise, onerror: () => {} });
	const saving = run.flush();
	expect(run.dirty()).toBe(true);
	run.type();
	response.resolve(undefined);
	await saving;
	expect(run.dirty()).toBe(true);
	await run.flush();
	expect(run.dirty()).toBe(false);
	const panel = source('ExcalidrawPanel.svelte');
	expect(panel.includes("addEventListener('beforeunload'")).toBe(true);
	expect(panel.includes('dirtyGuard?.register')).toBe(true);
	expect(panel.includes('Export recovery')).toBe(true);
	expect(panel.includes('Reload saved canvas')).toBe(true);
});

test('closing the active terminal replays the next retained tab from zero', () => {
	const run = new Function(
		'api',
		`
		let terminalTabs=[{id:'a',cursor:10},{id:'b',cursor:20}],activeTerminalTabId='a',scopedProjectId='p';
		const reportTerminalCount=()=>{},terminalRenderer={reset:()=>{}},addTerminalTab=()=>{},startTerminalPolling=()=>{};
		${fn('TerminalPanel.svelte', 'closeTerminalTab')}
		return ()=>{closeTerminalTab({stopPropagation:()=>{}},terminalTabs[0]);return terminalTabs[0]};
	`
	)(async () => {});
	expect(run()).toEqual({ id: 'b', cursor: 0 });
});

test('Git focus refresh is active-only, visibility-aware and throttled', () => {
	let requests = 0;
	const run = new Function(
		'loadRepository',
		`
		let active=true,repositoryLoading=false,lastRefresh=Date.now(),document={visibilityState:'visible'};
		${fn('RepositoryPanels.svelte', 'refreshOnFocus')}
		return {refreshOnFocus,age:()=>lastRefresh=0,hide:()=>document.visibilityState='hidden',
		show:()=>document.visibilityState='visible',deactivate:()=>active=false};
	`
	)(() => {
		requests++;
	});
	run.refreshOnFocus();
	expect(requests).toBe(0);
	run.age();
	run.hide();
	run.refreshOnFocus();
	expect(requests).toBe(0);
	run.show();
	run.refreshOnFocus();
	expect(requests).toBe(1);
	run.deactivate();
	run.refreshOnFocus();
	expect(requests).toBe(1);
});

test('compact canvas exit uses the shared dirty guard before unmounting it', () => {
	let selections = 0;
	const run = new Function(
		'chooseDevelopView',
		`
		let view='develop',developView='excalidraw';
		const dirtyGuard={block:()=>true};
		${fn('../ProjectWorkbench.svelte', 'openDevelopView')}
		return openDevelopView;
	`
	)(() => {
		selections++;
	});
	run('git');
	expect(selections).toBe(0);
});
