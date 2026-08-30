import { HermesProjectsCapabilityError } from '$lib/server/hermes-projects';
import { loadProjectViews } from '$lib/server/route-services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const loaded = await loadProjectViews();
		return {
			...loaded,
			projectsCapability: 'available' as const,
			projectsError: ''
		};
	} catch (cause) {
		return {
			projects: [],
			chatSessionCount: 0,
			cronSessionCount: 0,
			projectsCapability:
				cause instanceof HermesProjectsCapabilityError
					? ('unavailable' as const)
					: ('outage' as const),
			projectsError: cause instanceof Error ? cause.message : String(cause),
			reconciliationIssues: []
		};
	}
};
