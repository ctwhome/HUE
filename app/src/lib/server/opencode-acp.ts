import { HermesACP, type HermesACPOptions } from './hermes-acp';
import { hermesChildEnvironment } from './hermes-env';

export function openCodeChildEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries([
		...Object.entries(hermesChildEnvironment(base)),
		...Object.entries(base).filter(
			([name, value]) =>
				value !== undefined && (name.startsWith('OPENCODE_') || name.startsWith('XDG_'))
		)
	]);
}

export function isolatedOpenCodeEnvironment(
	base: NodeJS.ProcessEnv,
	home: string
): NodeJS.ProcessEnv {
	return Object.fromEntries([
		...['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'].flatMap((name) =>
			base[name] ? [[name, base[name] as string]] : []
		),
		['HOME', home],
		['XDG_CONFIG_HOME', `${home}/config`],
		['XDG_DATA_HOME', `${home}/data`],
		['XDG_CACHE_HOME', `${home}/cache`],
		['OPENCODE_DISABLE_AUTOUPDATE', '1'],
		['OPENCODE_DISABLE_MODELS_FETCH', '1']
	]);
}

export class OpenCodeACP extends HermesACP {
	constructor(
		options: Omit<HermesACPOptions, 'command' | 'args' | 'agentLabel' | 'environment'> = {}
	) {
		super({
			...options,
			command: 'opencode',
			args: ['acp'],
			agentLabel: 'OpenCode',
			environment: openCodeChildEnvironment
		});
	}
}
