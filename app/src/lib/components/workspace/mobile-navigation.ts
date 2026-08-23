export type MobilePane = 'projects' | 'sessions' | null;

export type NavigationMemory = {
	version: 1;
	projectId: string | null;
	sessionId: string | null;
	pane: MobilePane;
};

export type NavigationDestination = Omit<NavigationMemory, 'version'> & { explicit: boolean };
export type LaunchIntent = 'new-session' | 'capture' | 'share' | 'projects' | 'recents' | null;
export type LaunchSource = 'explicit' | 'intent' | 'notification' | 'remembered' | 'default';
export type LaunchDestination = NavigationDestination & {
	intent: LaunchIntent;
	token: string | null;
	source: LaunchSource;
};

export type MobileGesture = {
	status: 'pending' | 'active' | 'cancelled';
	action: 'open-sessions' | 'show-projects' | 'close-projects' | 'close-sessions' | null;
	startX: number;
	startY: number;
	deltaX: number;
	deltaY: number;
	pane: MobilePane;
};

export const NAVIGATION_MEMORY_KEY = 'hue:navigation:v1';

export function parseNavigationMemory(_raw: string | null): NavigationMemory | null {
	if (!_raw) return null;
	try {
		const value = JSON.parse(_raw) as Record<string, unknown>;
		if (
			value.version !== 1 ||
			(value.projectId !== null && typeof value.projectId !== 'string') ||
			(value.sessionId !== null && typeof value.sessionId !== 'string') ||
			!['projects', 'sessions', null].includes(value.pane as MobilePane)
		)
			return null;
		return {
			version: 1,
			projectId: value.projectId as string | null,
			sessionId: value.sessionId as string | null,
			pane: value.pane as MobilePane
		};
	} catch {
		return null;
	}
}

export function resolveLaunchDestination(
	_url: URL,
	_rawMemory: string | null,
	_projectIds: string[],
	_notification: { projectId: string | null; sessionId: string | null } | null = null
): LaunchDestination {
	const params = _url.searchParams;
	const explicit = params.has('project') || params.has('session') || params.has('pane');
	const memory = parseNavigationMemory(_rawMemory);
	const requestedIntent = explicit ? null : params.get('intent');
	const intent = ['new-session', 'capture', 'share', 'projects', 'recents'].includes(
		requestedIntent ?? ''
	)
		? (requestedIntent as Exclude<LaunchIntent, null>)
		: null;
	if (intent === 'capture' || intent === 'share' || intent === 'new-session') {
		const token = params.get('token');
		return {
			projectId: null,
			sessionId: null,
			pane: null,
			explicit: false,
			intent,
			token: token && /^[A-Za-z0-9-]{1,128}$/.test(token) ? token : null,
			source: 'intent'
		};
	}
	if (intent === 'projects') {
		return {
			projectId: null,
			sessionId: null,
			pane: 'projects',
			explicit: false,
			intent,
			token: null,
			source: 'intent'
		};
	}
	if (intent === 'recents') {
		const rememberedProject = memory?.projectId;
		const projectId =
			rememberedProject && _projectIds.includes(rememberedProject)
				? rememberedProject
				: (_projectIds[0] ?? null);
		return {
			projectId,
			sessionId: null,
			pane: 'sessions',
			explicit: false,
			intent,
			token: null,
			source: 'intent'
		};
	}
	if (!explicit && _notification) {
		const projectId = _notification.projectId;
		if (projectId === null || _projectIds.includes(projectId)) {
			return {
				projectId,
				sessionId: _notification.sessionId,
				pane: null,
				explicit: false,
				intent: null,
				token: null,
				source: 'notification'
			};
		}
	}
	const requestedProject = explicit
		? params.get('project') === 'none'
			? null
			: params.get('project')
		: memory?.projectId;
	if (!explicit && !memory)
		return {
			projectId: _projectIds[0] ?? null,
			sessionId: null,
			pane: null,
			explicit: false,
			intent: null,
			token: null,
			source: 'default'
		};
	const projectExists =
		requestedProject === null ||
		(typeof requestedProject === 'string' && _projectIds.includes(requestedProject));
	if (requestedProject === undefined || !projectExists)
		return {
			projectId: null,
			sessionId: null,
			pane: 'projects',
			explicit,
			intent: null,
			token: null,
			source: explicit ? 'explicit' : 'remembered'
		};
	const pane = explicit
		? params.get('pane') === 'projects' || params.get('pane') === 'sessions'
			? (params.get('pane') as Exclude<MobilePane, null>)
			: null
		: (memory?.pane ?? null);
	return {
		projectId: requestedProject,
		sessionId: explicit ? params.get('session') : (memory?.sessionId ?? null),
		pane,
		explicit,
		intent: null,
		token: null,
		source: explicit ? 'explicit' : 'remembered'
	};
}

export function resolveNavigationDestination(
	url: URL,
	rawMemory: string | null,
	projectIds: string[]
): NavigationDestination {
	const {
		intent: _intent,
		token: _token,
		source: _source,
		...destination
	} = resolveLaunchDestination(url, rawMemory, projectIds);
	return destination;
}

export function beginMobileGesture(_options: {
	pane: MobilePane;
	hasSession: boolean;
	startX: number;
	startY: number;
	viewportWidth: number;
	startedOnDrawer: boolean;
	excluded: boolean;
	dialogOpen: boolean;
}): MobileGesture | null {
	if (_options.excluded || _options.dialogOpen) return null;
	if (_options.pane) {
		if (!_options.startedOnDrawer) return null;
	} else if (
		!_options.hasSession ||
		_options.startX < 24 ||
		_options.startX > Math.min(56, _options.viewportWidth - 24)
	) {
		return null;
	}
	return {
		status: 'pending',
		action: null,
		startX: _options.startX,
		startY: _options.startY,
		deltaX: 0,
		deltaY: 0,
		pane: _options.pane
	};
}

export function updateMobileGesture(gesture: MobileGesture, _x: number, _y: number): MobileGesture {
	const deltaX = _x - gesture.startX;
	const deltaY = _y - gesture.startY;
	if (gesture.status === 'cancelled') return gesture;
	if (gesture.status === 'active') return { ...gesture, deltaX, deltaY };
	if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 10) return { ...gesture, deltaX, deltaY };
	if (Math.abs(deltaY) > Math.abs(deltaX))
		return { ...gesture, deltaX, deltaY, status: 'cancelled' };
	const pane = gesture.pane;
	const action =
		pane === 'sessions'
			? deltaX > 0
				? 'show-projects'
				: 'close-sessions'
			: pane === 'projects'
				? deltaX < 0
					? 'close-projects'
					: null
				: deltaX > 0
					? 'open-sessions'
					: null;
	return { ...gesture, deltaX, deltaY, status: action ? 'active' : 'cancelled', action };
}

export function finishMobileGesture(
	gesture: MobileGesture,
	_width: number,
	_velocityX: number
): { commit: boolean; action: MobileGesture['action']; destination: MobilePane } {
	if (gesture.status !== 'active' || !gesture.action)
		return { commit: false, action: gesture.action, destination: null };
	const direction =
		gesture.action === 'close-projects' || gesture.action === 'close-sessions' ? -1 : 1;
	const commit =
		Math.abs(gesture.deltaX) / Math.max(1, _width) >= 0.28 || _velocityX * direction >= 0.5;
	const destination = !commit
		? null
		: gesture.action === 'open-sessions'
			? 'sessions'
			: gesture.action === 'show-projects'
				? 'projects'
				: null;
	return { commit, action: gesture.action, destination };
}

export function compactModelLabel(_modelId: string, name: string): string {
	const id = _modelId.trim();
	if (!id) return name;
	return id.split(/[/:]/).filter(Boolean).at(-1) ?? name;
}
