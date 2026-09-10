import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { loadProjectViews, services } from '$lib/server/route-services';
import type { PageServerLoad } from './$types';

export const load = ((_event) => {
	const store = services().store;
	const initial = {
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
