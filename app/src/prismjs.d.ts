declare module 'prismjs' {
	const Prism: {
		languages: Record<string, unknown>;
		highlight(code: string, grammar: unknown, language: string): string;
	};
	export default Prism;
}
