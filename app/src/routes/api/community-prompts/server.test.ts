import { expect, test } from 'bun:test';

const upstreamPrompt = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	title: `Prompt ${id}`,
	description: `Description ${id}`,
	content: `Content ${id}`,
	category: { name: 'Development' },
	...overrides
});

test('bounds and validates the moderated upstream catalog', async () => {
	let requested = '';
	let signal: AbortSignal | undefined;
	const upstream = [
		upstreamPrompt('prompt-0'),
		upstreamPrompt('prompt-0', { title: 'Duplicate' }),
		null,
		'not an object',
		upstreamPrompt('too-long', { title: 'x'.repeat(201) }),
		upstreamPrompt('missing-content', { content: null }),
		...Array.from({ length: 105 }, (_, index) => upstreamPrompt(`prompt-${index + 1}`))
	];
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requested = String(input);
		signal = init?.signal ?? undefined;
		return Response.json({ prompts: upstream });
	}) as typeof fetch;

	const { GET } = await import('./+server');
	const response = await GET({ fetch: fetcher } as never);
	const body = (await response.json()) as { prompts: Array<Record<string, string>> };

	expect(requested).toBe('https://prompts.chat/api/prompts?perPage=100&sort=upvotes&type=TEXT');
	expect(signal).toBeInstanceOf(AbortSignal);
	expect(response.status).toBe(200);
	expect(body.prompts).toHaveLength(100);
	expect(new Set(body.prompts.map(({ id }) => id)).size).toBe(100);
	expect(body.prompts[0]).toEqual({
		id: 'prompt-0',
		title: 'Prompt prompt-0',
		category: 'Development',
		description: 'Description prompt-0',
		prompt: 'Content prompt-0'
	});
});

test('rejects oversized upstream responses and serves a useful fallback', async () => {
	const fetcher = (async () =>
		new Response(
			JSON.stringify({ prompts: [upstreamPrompt('huge', { content: 'x'.repeat(2_100_000) })] }),
			{
				headers: { 'content-type': 'application/json' }
			}
		)) as unknown as typeof fetch;

	const { GET } = await import('./+server');
	const response = await GET({ fetch: fetcher } as never);
	const body = (await response.json()) as { prompts: Array<Record<string, string>> };

	expect(response.status).toBe(200);
	expect(body.prompts.length).toBeGreaterThan(0);
	expect(body.prompts.every(({ prompt }) => prompt.length <= 20_000)).toBe(true);
	expect(body.prompts.some(({ id }) => id === 'huge')).toBe(false);
});

test('serves bounded catalog data for upstream outages and malformed bodies', async () => {
	const { GET } = await import('./+server');
	const fetchers = [
		(async () => new Response('', { status: 503 })) as unknown as typeof fetch,
		(async () =>
			new Response('{broken', {
				headers: { 'content-type': 'application/json' }
			})) as unknown as typeof fetch,
		(async () => Response.json(null)) as unknown as typeof fetch,
		(async () => Response.json({ prompts: null })) as unknown as typeof fetch
	];

	for (const fetcher of fetchers) {
		const response = await GET({ fetch: fetcher } as never);
		const body = (await response.json()) as { prompts: Array<Record<string, string>> };
		expect(response.status).toBe(200);
		expect(body.prompts.length).toBeGreaterThan(0);
		expect(body.prompts.length).toBeLessThanOrEqual(100);
		expect(new Set(body.prompts.map(({ id }) => id)).size).toBe(body.prompts.length);
	}
});
