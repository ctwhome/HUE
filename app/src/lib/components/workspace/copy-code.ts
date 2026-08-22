export async function copyCode(code: string, notify: (message: string) => void): Promise<void> {
	try {
		await navigator.clipboard.writeText(code);
		notify('Code copied');
	} catch {
		const fallback = document.createElement('textarea');
		fallback.value = code;
		fallback.style.position = 'fixed';
		fallback.style.opacity = '0';
		document.body.append(fallback);
		fallback.select();
		notify(document.execCommand('copy') ? 'Code copied' : 'Copy unavailable');
		fallback.remove();
	}
}
