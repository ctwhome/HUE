import { ApiError } from './message-state.svelte';
import type { Api, Project } from './types';
import { parseApiResponse } from '$lib/api-response';

export const workspaceApi: Api = async <T>(url: string, options?: RequestInit): Promise<T> => {
	const response = await fetch(url, {
		...options,
		headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) }
	});
	const body = (await parseApiResponse<T>(response)) as T & {
		error?: string;
		project?: Project;
		restored?: boolean;
		reconciliationRequired?: boolean;
	};
	if (response.ok) return body;
	const cause = new ApiError(body.error ?? `Request failed (${response.status})`);
	if (body.project) Object.assign(cause, { project: body.project });
	if (body.restored !== undefined) Object.assign(cause, { restored: body.restored });
	if (body.reconciliationRequired !== undefined) {
		Object.assign(cause, { reconciliationRequired: body.reconciliationRequired });
	}
	throw cause;
};
