import { json } from '@sveltejs/kit';
import { settingsFile } from '$lib/server/settings';
import { getSetting, setSetting, type SettingsValue } from '$lib/settings';
import type { RequestHandler } from './$types';

function failure(cause: unknown) {
	const error = cause instanceof Error ? cause.message : String(cause);
	return json({ error }, { status: error.includes('changed') ? 409 : 400 });
}

export const GET: RequestHandler = ({ url }) => {
	try { return json(url.searchParams.has('raw') ? settingsFile.raw() : settingsFile.read(), { headers: { 'cache-control': 'no-store' } }); }
	catch (cause) { return failure(cause); }
};

export const PUT: RequestHandler = async ({ request, url }) => {
	if (request.headers.get('origin') !== url.origin) return json({ error: 'Same-origin access required' }, { status: 403 });
	try {
		const body = await request.json();
		if (typeof body.revision !== 'string') throw new Error('Settings revision is required');
		return json(settingsFile.save(body.settings, body.revision));
	} catch (cause) { return failure(cause); }
};

export const PATCH: RequestHandler = async ({ request, url }) => {
	if (request.headers.get('origin') !== url.origin) return json({ error: 'Same-origin access required' }, { status: 403 });
	try {
		const body = await request.json();
		if (typeof body.key !== 'string') throw new Error('Settings key is required');
		const current = settingsFile.read();
		if (JSON.stringify(getSetting(current.settings, body.key) ?? null) !== JSON.stringify(body.expected ?? null)) throw new Error('Setting changed in another editor. Try your change again.');
		setSetting(current.settings, body.key, body.remove ? undefined : body.value as SettingsValue);
		return json(settingsFile.save(current.settings, current.revision));
	} catch (cause) { return failure(cause); }
};
