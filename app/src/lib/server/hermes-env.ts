const exactNames = new Set([
	'PATH',
	'HOME',
	'SHELL',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'TERM',
	'SSL_CERT_FILE',
	'SSL_CERT_DIR',
	'NODE_EXTRA_CA_CERTS',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'ALL_PROXY',
	'NO_PROXY',
	'GITHUB_TOKEN',
	'GH_TOKEN',
	'GOOGLE_APPLICATION_CREDENTIALS'
]);

const providerPrefixes = [
	'ANTHROPIC_',
	'OPENAI_',
	'OPENROUTER_',
	'GOOGLE_',
	'GEMINI_',
	'AWS_',
	'AZURE_',
	'GROQ_',
	'MISTRAL_',
	'XAI_',
	'COHERE_',
	'DEEPSEEK_',
	'OLLAMA_',
	'HF_',
	'HUGGINGFACE_',
	'NVIDIA_',
	'TOGETHER_',
	'FIREWORKS_',
	'PERPLEXITY_',
	'COPILOT_',
	'CLAUDE_',
	'VERTEX_',
	'BEDROCK_'
];

export function hermesChildEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(base).filter(
			([name, value]) =>
				value !== undefined &&
				!name.startsWith('HUE_') &&
				(exactNames.has(name) ||
					name.startsWith('LC_') ||
					name.startsWith('HERMES_') ||
					providerPrefixes.some((prefix) => name.startsWith(prefix)) ||
					name.endsWith('_API_KEY'))
		)
	);
}
