export const INSTALL_DISMISSED_KEY = 'hue:install-dismissed:v1';

export function installOfferVisible(promptAvailable: boolean, dismissed: boolean) {
	return promptAvailable && !dismissed;
}

export function actionFailureStatus(action: 'copy' | 'share', cause: unknown) {
	if (action === 'share' && cause instanceof DOMException && cause.name === 'AbortError') {
		return 'Sharing cancelled.';
	}
	return action === 'copy'
		? 'Could not copy link. Use the browser address bar instead.'
		: 'Could not share link. Copy it instead.';
}

export function pinGuidance(projectName?: string | null, sessionTitle?: string | null) {
	const subject = sessionTitle
		? `current Session${sessionTitle ? ` “${sessionTitle}”` : ''}`
		: projectName
			? `current Project “${projectName}”`
			: 'current HUE view';
	return `Use copy or share for a link to the ${subject}. Add it from your browser menu if your browser supports home-screen shortcuts. HUE cannot programmatically pin a Project or Session.`;
}
