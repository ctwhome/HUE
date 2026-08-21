import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	json({ ok: true, service: 'hue-workspace', runtime: 'bun', protocol: 'acp-v1' });
