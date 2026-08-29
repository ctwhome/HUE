import { expect, test } from 'bun:test';
import { groupPromptCatalog, loadPromptCatalog, parsePromptCatalog } from './prompt-catalog';

test('parses the complete upstream CSV shape including quoted multiline prompts', () => {
	const prompts = parsePromptCatalog(
		'act,prompt,for_devs,type,contributor\n"Code, reviewer","Review line one.\nReview line two with ""quotes"".",TRUE,TEXT,dev\nWriter,Improve prose,FALSE,TEXT,editor\n"Code, reviewer","Review line one.\nReview line two with ""quotes"".",TRUE,TEXT,copy\n'
	);

	expect(prompts).toEqual([
		expect.objectContaining({
			title: 'Code, reviewer',
			prompt: 'Review line one.\nReview line two with "quotes".',
			category: 'Engineering'
		}),
		expect.objectContaining({ title: 'Writer', prompt: 'Improve prose', category: 'Writing' })
	]);
});

test('search keeps matching prompts in their useful grouped sections', () => {
	const prompts = parsePromptCatalog(
		'act,prompt,for_devs,type,contributor\nCode Reviewer,Review source code,TRUE,TEXT,dev\nMarketing Strategist,Review a campaign,FALSE,TEXT,marketer\nTeacher,Plan a lesson,FALSE,TEXT,teacher\n'
	);

	expect(groupPromptCatalog(prompts, 'review')).toEqual([
		{ category: 'Engineering', items: [expect.objectContaining({ title: 'Code Reviewer' })] },
		{ category: 'Marketing', items: [expect.objectContaining({ title: 'Marketing Strategist' })] }
	]);
});

test('retries catalog loading after a rejected request', async () => {
	const originalFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = (async () => {
		requests += 1;
		if (requests === 1) return new Response('', { status: 503 });
		return new Response('act,prompt\nReviewer,Review this');
	}) as unknown as typeof fetch;

	try {
		await expect(loadPromptCatalog()).rejects.toThrow('Prompt catalog is unavailable');
		expect(await loadPromptCatalog()).toEqual([
			expect.objectContaining({ title: 'Reviewer', prompt: 'Review this' })
		]);
		expect(requests).toBe(2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
