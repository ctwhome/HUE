import { json } from '@sveltejs/kit';
import { basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { sameOriginMutationAllowed } from '$lib/server/same-origin';
import { pickSystemFolder } from '$lib/server/system-folder-picker';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	if (!sameOriginMutationAllowed(request, url)) {
		return json({ error: 'Folder selection requires same-origin access' }, { status: 403 });
	}
	try {
		const selected = await pickSystemFolder();
		if (!selected) return json({ path: null, name: null });
		const path = realpathSync(selected);
		return json({ path, name: basename(path) || path });
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
	}
};
