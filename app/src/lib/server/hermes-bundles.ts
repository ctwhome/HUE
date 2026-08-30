import { parseBundleReference } from '$lib/bundle';

type BundlesTransport = {
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
};

type BundleAccess = { provenance: 'custom' | 'bundled' | 'hub'; editable: boolean };

export type HermesBundle = {
	name: string;
	slug: string;
	description: string;
	skills: string[];
	instruction: string;
};

const SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function field(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
		throw new Error(`${name} is invalid`);
	}
	return value.trim();
}

function skills(value: unknown): string[] {
	if (!Array.isArray(value) || !value.length || value.length > 100) {
		throw new Error('Bundle must reference at least one skill and at most 100 skills');
	}
	const result = value.map((skill) => {
		if (typeof skill !== 'string' || !SKILL_NAME.test(skill)) {
			throw new Error('Bundle contains an invalid skill name');
		}
		return skill;
	});
	if (new Set(result).size !== result.length) throw new Error('Bundle skills must be unique');
	return result;
}

function normalizeBundle(value: unknown): HermesBundle {
	if (!value || typeof value !== 'object') throw new Error('Hermes returned an invalid Bundle');
	const bundle = value as Record<string, unknown>;
	const name = parseBundleReference(bundle.name);
	if (!name) throw new Error('Hermes returned an invalid Bundle name');
	const slug = field(bundle.slug, 'Hermes Bundle slug', 128);
	if (!slug) throw new Error('Hermes returned an invalid Bundle slug');
	let bundleSkills: string[];
	try {
		bundleSkills = skills(bundle.skills);
	} catch {
		throw new Error('Hermes returned an invalid Bundle skill');
	}
	return {
		name,
		slug,
		description: field(bundle.description ?? '', 'Hermes Bundle description', 1_000),
		skills: bundleSkills,
		instruction: field(bundle.instruction ?? '', 'Hermes Bundle instruction', 10_000)
	};
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Bundle input must be an object');
	}
	return value as Record<string, unknown>;
}

export class HermesBundles {
	constructor(
		private readonly transport: BundlesTransport,
		private readonly profile: string,
		private readonly inventory?: () => Promise<unknown[]>,
		private readonly access?: (name: string) => BundleAccess
	) {}

	async list(): Promise<HermesBundle[]> {
		const result = await this.transport.request<{ bundles?: unknown }>(
			'bundles.list',
			this.params()
		);
		if (!Array.isArray(result.bundles)) throw new Error('Hermes returned an invalid Bundles list');
		return result.bundles.map(normalizeBundle);
	}

	async get(slug: string): Promise<HermesBundle> {
		const result = await this.transport.request<{ bundle?: unknown }>(
			'bundles.get',
			this.params({ slug: this.name(slug) })
		);
		return normalizeBundle(result.bundle);
	}

	async create(value: unknown): Promise<HermesBundle> {
		const input = object(value);
		this.only(input, ['name', 'description', 'skills', 'instruction']);
		const name = this.name(input.name);
		const result = await this.transport.request<{ bundle?: unknown }>(
			'bundles.create',
			this.params({
				name,
				skills: skills(input.skills),
				...(input.description !== undefined
					? { description: field(input.description, 'description', 1_000) }
					: {}),
				...(input.instruction !== undefined
					? { instruction: field(input.instruction, 'instruction', 10_000) }
					: {})
			})
		);
		return normalizeBundle(result.bundle);
	}

	async update(slug: string, value: unknown): Promise<HermesBundle> {
		const input = object(value);
		this.only(input, ['description', 'skills', 'instruction']);
		if (!Object.keys(input).length) throw new Error('No bundle changes supplied');
		const bundleSlug = this.name(slug);
		const result = await this.transport.request<{ bundle?: unknown }>(
			'bundles.update',
			this.params({
				slug: bundleSlug,
				...(input.skills !== undefined ? { skills: skills(input.skills) } : {}),
				...(input.description !== undefined
					? { description: field(input.description, 'description', 1_000) }
					: {}),
				...(input.instruction !== undefined
					? { instruction: field(input.instruction, 'instruction', 10_000) }
					: {})
			})
		);
		return normalizeBundle(result.bundle);
	}

	async delete(slug: string): Promise<{ deleted: true }> {
		await this.transport.request('bundles.delete', this.params({ slug: this.name(slug) }));
		return { deleted: true };
	}

	async listSkills() {
		if (!this.inventory || !this.access) throw new Error('Hermes skill inventory is unavailable');
		const inventory = await this.inventory();
		if (!Array.isArray(inventory)) throw new Error('Hermes returned an invalid skill inventory');
		return inventory.map((value) => {
			if (!value || typeof value !== 'object') throw new Error('Hermes returned an invalid skill');
			const skill = value as Record<string, unknown>;
			if (typeof skill.name !== 'string' || !SKILL_NAME.test(skill.name)) {
				throw new Error('Hermes returned an invalid skill name');
			}
			const access = this.access!(skill.name);
			return {
				name: skill.name,
				...(typeof skill.description === 'string' ? { description: skill.description } : {}),
				...(typeof skill.category === 'string' ? { category: skill.category } : {}),
				enabled: skill.enabled === true,
				provenance: access.provenance,
				permissions: { read: true, write: access.editable, delete: access.editable }
			};
		});
	}

	private params(value: Record<string, unknown> = {}) {
		return { profile: this.profile, ...value };
	}

	private name(value: unknown): string {
		const name = parseBundleReference(value);
		if (!name) throw new Error('Bundle name is required and must be at most 128 characters');
		return name;
	}

	private only(input: Record<string, unknown>, allowed: string[]) {
		if (Object.keys(input).some((key) => !allowed.includes(key))) {
			throw new Error('Bundle input contains unsupported fields');
		}
	}
}
