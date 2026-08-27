import { expect, test } from 'bun:test';
import { groupPromptCatalog, parsePromptCatalog } from './prompt-catalog';

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
