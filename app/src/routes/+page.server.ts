import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { loadProjectViews, services } from '$lib/server/route-services';
import { settingsFile } from '$lib/server/settings';
import type { SettingsSnapshot } from '$lib/settings';
import type { PageServerLoad } from './$types';

export const load = ((_event) => {
	const store = services().store;
	let settings: SettingsSnapshot | null = null;
	let settingsError = '';
	try { settings = settingsFile.read(); }
	catch (cause) { settingsError = cause instanceof Error ? cause.message : String(cause); }
	const initial = {
		settings,
		settingsError,
		projects: [] as Awaited<ReturnType<typeof loadProjectViews>>['projects'],
		chatSessionCount: store.countSessions(null, 'unscheduled'),
		chatIndicators: store.getSessionIndicatorCounts(null, 'unscheduled'),
		cronSessionCount: store.countSessions(null, 'scheduled'),
		projectsCapability: 'available' as const,
		projectsError: '',
		reconciliationIssues: [] as Awaited<
			ReturnType<typeof loadProjectViews>
		>['reconciliationIssues'],
		projectsLoading: true
	};
	const projectReconciliation = loadProjectViews().then(
		(loaded) => ({
			...loaded,
			projectsCapability: 'available' as const,
			projectsError: '',
			projectsLoading: false
		}),
		(cause: unknown) => ({
			...initial,
			projectsLoading: false,
			projectsCapability:
				cause instanceof HermesProjectsCapabilityError
					? ('unavailable' as const)
					: ('outage' as const),
			projectsError: cause instanceof Error ? cause.message : String(cause)
		})
	);
	return { ...initial, projectReconciliation };
}) satisfies PageServerLoad;
