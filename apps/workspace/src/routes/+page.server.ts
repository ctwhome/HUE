import { services } from '$lib/server/services';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	projects: services().store.listProjects()
});
