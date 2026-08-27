export type CatalogPrompt = {
	id: string;
	title: string;
	category: string;
	description: string;
	prompt: string;
};

const CATEGORY_RULES: Array<[string, RegExp]> = [
	[
		'Engineering',
		/\b(code|coding|developer|programmer|software|terminal|linux|javascript|typescript|python|java|sql|database|devops|security|architect|debug|reviewer)\b/i
	],
	[
		'Writing',
		/\b(write|writer|writing|editor|proofread|translator|translation|copywriter|story|essay|article|blog|documentation|summarize)\b/i
	],
	[
		'Marketing',
		/\b(marketing|campaign|advertis|seo|social media|brand|sales|copywriting|conversion|audience)\b/i
	],
	[
		'Business',
		/\b(business|entrepreneur|startup|product manager|finance|financial|accounting|investment|consultant|strategy|strategist)\b/i
	],
	[
		'Education',
		/\b(teacher|tutor|student|lesson|learn|education|school|course|study|instructor|coach)\b/i
	],
	[
		'Research',
		/\b(research|scientist|analysis|analyst|academic|paper|evidence|data science|statistic)\b/i
	],
	[
		'Creative',
		/\b(creative|artist|designer|design|music|poet|poetry|screenwriter|film|game|photograph)\b/i
	],
	[
		'Productivity',
		/\b(productivity|project plan|planner|organize|meeting|workflow|time management|task|schedule)\b/i
	],
	[
		'Lifestyle',
		/\b(health|fitness|diet|nutrition|travel|relationship|career|personal|wellness|recipe|cooking)\b/i
	],
	['Roleplay', /\b(act as|roleplay|simulate|character|interviewer|terminal|console)\b/i]
];

function inferCategory(title: string, prompt: string): string {
	const text = `${title} ${prompt.slice(0, 500)}`;
	return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'Other';
}

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

export function parsePromptCatalog(csv: string): CatalogPrompt[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < csv.length; index += 1) {
		const character = csv[index]!;
		if (character === '"') {
			if (quoted && csv[index + 1] === '"') {
				field += '"';
				index += 1;
			} else quoted = !quoted;
		} else if (character === ',' && !quoted) {
			row.push(field);
			field = '';
		} else if ((character === '\n' || character === '\r') && !quoted) {
			if (character === '\r' && csv[index + 1] === '\n') index += 1;
			row.push(field);
			if (row.some(Boolean)) rows.push(row);
			row = [];
			field = '';
		} else field += character;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}

	const seen = new Set<string>();
	return rows.slice(1).flatMap(([title = '', prompt = ''], index) => {
		const cleanTitle = title.trim();
		const cleanPrompt = prompt.trim();
		if (!cleanTitle || !cleanPrompt) return [];
		const duplicateKey = `${cleanTitle} ${cleanPrompt}`.toLowerCase().replaceAll(/\s+/g, ' ');
		if (seen.has(duplicateKey)) return [];
		seen.add(duplicateKey);
		return [
			{
				id: `${index}-${cleanTitle
					.toLowerCase()
					.replaceAll(/[^a-z0-9]+/g, '-')
					.replaceAll(/^-|-$/g, '')}`,
				title: cleanTitle,
				category: inferCategory(cleanTitle, cleanPrompt),
				description: cleanPrompt.replaceAll(/\s+/g, ' ').slice(0, 120),
				prompt: cleanPrompt
			}
		];
	});
}

let catalogPromise: Promise<CatalogPrompt[]> | null = null;

export function loadPromptCatalog(): Promise<CatalogPrompt[]> {
	return (catalogPromise ??= fetch('/prompt-catalog.csv')
		.then((response) => {
			if (!response.ok) throw new Error('Prompt catalog is unavailable');
			return response.text();
		})
		.then(parsePromptCatalog));
}
