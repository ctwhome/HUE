import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CATALOG_URL = 'https://prompts.chat/api/prompts?perPage=100&sort=upvotes&type=TEXT';
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_PROMPTS = 100;
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_PROMPT_LENGTH = 20_000;

type UpstreamPrompt = {
	id?: unknown;
	title?: unknown;
	description?: unknown;
	content?: unknown;
	category?: { name?: unknown } | null;
};

type CatalogPrompt = {
	id: string;
	title: string;
	category: string;
	description: string;
	prompt: string;
};

const fallbackPrompts: CatalogPrompt[] = [
	{
		id: 'fallback-code-reviewer',
		title: 'Code Reviewer',
		category: 'Development',
		description: 'Review code for correctness, safety, and maintainability.',
		prompt: 'Review this code for bugs, security risks, regressions, and missing tests.'
	},
	{
		id: 'fallback-writing-editor',
		title: 'Writing Editor',
		category: 'Writing',
		description: 'Improve clarity and flow while preserving the original meaning.',
		prompt:
			'Edit this writing for clarity, concision, and natural tone without changing its meaning.'
	},
	{
		id: 'fallback-project-planner',
		title: 'Project Planner',
		category: 'Productivity',
		description: 'Turn a goal into a practical sequence of next steps.',
		prompt:
			'Break this goal into ordered, concrete steps with dependencies, risks, and completion checks.'
	}
];
let lastKnownGood: CatalogPrompt[] = fallbackPrompts;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function mapPrompt(value: unknown): CatalogPrompt | null {
	if (!isObject(value)) return null;
	const item = value as UpstreamPrompt;
	if (
		!boundedString(item.id, MAX_ID_LENGTH) ||
		!boundedString(item.title, MAX_TITLE_LENGTH) ||
		!boundedString(item.content, MAX_PROMPT_LENGTH) ||
		(item.description !== undefined &&
			item.description !== null &&
			!boundedString(item.description, MAX_DESCRIPTION_LENGTH)) ||
		(item.category !== undefined && item.category !== null && !isObject(item.category)) ||
		(isObject(item.category) &&
			item.category.name !== undefined &&
			item.category.name !== null &&
			!boundedString(item.category.name, MAX_CATEGORY_LENGTH))
	)
		return null;

	return {
		id: item.id,
		title: item.title,
		category: boundedString(item.category?.name, MAX_CATEGORY_LENGTH)
			? item.category.name
			: 'Other',
		description: boundedString(item.description, MAX_DESCRIPTION_LENGTH)
			? item.description
			: item.content.replaceAll(/\s+/g, ' ').slice(0, 120),
		prompt: item.content
	};
}

async function readBounded(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
		throw new Error('Prompt catalog response is too large');
	if (!response.body) return '';

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		size += value.byteLength;
		if (size > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error('Prompt catalog response is too large');
		}
		text += decoder.decode(value, { stream: true });
	}
}

export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(5_000) });
		if (!response.ok) throw new Error(`Prompt catalog returned ${response.status}`);
		const body: unknown = JSON.parse(await readBounded(response));
		if (!isObject(body) || !Array.isArray(body.prompts))
			throw new Error('Prompt catalog response is malformed');

		const seen = new Set<string>();
		const prompts: CatalogPrompt[] = [];
		for (const value of body.prompts) {
			const prompt = mapPrompt(value);
			if (!prompt || seen.has(prompt.id)) continue;
			seen.add(prompt.id);
			prompts.push(prompt);
			if (prompts.length === MAX_PROMPTS) break;
		}
		if (!prompts.length) throw new Error('Prompt catalog contains no valid prompts');
		lastKnownGood = prompts;
	} catch {
		// Keep serving the bounded last valid catalog during upstream failures.
	}

	return json({ prompts: lastKnownGood });
};
