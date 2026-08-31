export type CatalogPrompt = {
	id: string;
	title: string;
	category: string;
	description: string;
	prompt: string;
};

export function groupPromptCatalog(prompts: CatalogPrompt[], query = '') {
	const normalized = query.trim().toLowerCase();
	const matches = normalized
		? prompts.filter((item) =>
				`${item.title} ${item.category} ${item.description} ${item.prompt}`
					.toLowerCase()
					.includes(normalized)
			)
		: prompts;
	return [...new Set(matches.map(({ category }) => category))]
		.sort((left, right) => left.localeCompare(right))
		.map((category) => ({ category, items: matches.filter((item) => item.category === category) }));
}

let catalogPromise: Promise<CatalogPrompt[]> | null = null;
let catalogRetryAt = 0;

export function loadPromptCatalog(): Promise<CatalogPrompt[]> {
	if (catalogPromise && catalogRetryAt && Date.now() >= catalogRetryAt) catalogPromise = null;
	return (catalogPromise ??= fetch('/api/community-prompts')
		.then((response) => {
			if (!response.ok) throw new Error('Prompt catalog is unavailable');
			return response.json() as Promise<{ prompts: CatalogPrompt[] }>;
		})
		.then(({ prompts }) => {
			catalogRetryAt = 0;
			return prompts;
		})
		.catch((cause) => {
			catalogRetryAt = Date.now() + 30_000;
			throw cause;
		}));
}
