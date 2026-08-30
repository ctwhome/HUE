export async function copyCode(
	code: string,
	notify: (message: string) => void,
	successMessage = 'Code copied'
): Promise<void> {
	try {
		await navigator.clipboard.writeText(code);
		notify(successMessage);
	} catch {
		const fallback = document.createElement('textarea');
		fallback.value = code;
		fallback.style.position = 'fixed';
		fallback.style.opacity = '0';
		document.body.append(fallback);
		fallback.select();
		notify(document.execCommand('copy') ? successMessage : 'Copy unavailable');
		fallback.remove();
	}
}
