import { expect, test } from 'bun:test';
import { groupPromptCatalog, loadPromptCatalog } from './prompt-catalog';

test('search keeps matching prompts in their useful grouped sections', () => {
	const prompts = [
		{
			id: 'reviewer',
			title: 'Code Reviewer',
			category: 'Engineering',
			description: 'Review source code',
			prompt: 'Review source code'
		},
		{
			id: 'marketing',
			title: 'Marketing Strategist',
			category: 'Marketing',
			description: 'Review a campaign',
			prompt: 'Review a campaign'
		}
	];

	expect(groupPromptCatalog(prompts, 'review')).toEqual([
		{ category: 'Engineering', items: [expect.objectContaining({ title: 'Code Reviewer' })] },
		{ category: 'Marketing', items: [expect.objectContaining({ title: 'Marketing Strategist' })] }
	]);
});

test('does not retry a failed catalog request on repeated focus-triggered loads', async () => {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	let requests = 0;
	let now = 1_000;
	Date.now = () => now;
	globalThis.fetch = (async () => {
		requests += 1;
		return requests === 1
			? new Response('', { status: 503 })
			: Response.json({
					prompts: [
						{
							id: 'reviewer',
							title: 'Reviewer',
							category: 'Engineering',
							description: 'Review this',
							prompt: 'Review this'
						}
					]
				});
	}) as unknown as typeof fetch;

	try {
		await expect(loadPromptCatalog()).rejects.toThrow('Prompt catalog is unavailable');
		await expect(loadPromptCatalog()).rejects.toThrow('Prompt catalog is unavailable');
		await expect(loadPromptCatalog()).rejects.toThrow('Prompt catalog is unavailable');
		expect(requests).toBe(1);

		now += 30_001;
		expect(await loadPromptCatalog()).toEqual([expect.objectContaining({ id: 'reviewer' })]);
		expect(await loadPromptCatalog()).toEqual([expect.objectContaining({ id: 'reviewer' })]);
		expect(requests).toBe(2);
	} finally {
		globalThis.fetch = originalFetch;
		Date.now = originalNow;
	}
});
