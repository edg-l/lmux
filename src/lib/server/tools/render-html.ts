const MAX_HTML_SIZE = 200 * 1024; // 200KB

export function renderHtml(args: { html: string }): { result: string; error?: boolean } {
	if (!args.html || typeof args.html !== 'string' || !args.html.trim()) {
		return { result: 'Error: html is required.', error: true };
	}

	if (args.html.length > MAX_HTML_SIZE) {
		return { result: 'Error: HTML too large (max 200KB).', error: true };
	}

	return { result: 'HTML demo rendered successfully.' };
}
