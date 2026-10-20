/** Error responses of the API (RFC 9457 problem+json) as readable n8n error messages. */

export interface Problem {
	title?: string;
	detail?: string;
	code?: string;
	errors?: Array<{ path?: string; message?: string; code?: string }>;
	render_id?: string;
	request_id?: string;
	doc_url?: string;
}

export function asProblem(body: unknown): Problem {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as Problem;
	if (typeof body === 'string') {
		try {
			const parsed: unknown = JSON.parse(body);
			if (parsed && typeof parsed === 'object') return parsed as Problem;
		} catch {
			return { detail: body.slice(0, 500) };
		}
	}
	return {};
}

/** The detail, each field problem, and the render the error belongs to. */
export function describeProblem(problem: Problem, status: number): string {
	const parts = [problem.detail || problem.title || `The API answered ${status}.`];
	for (const error of (problem.errors ?? []).slice(0, 10)) {
		if (error.message) parts.push(error.path ? `${error.path}: ${error.message}` : error.message);
	}
	if (problem.render_id) parts.push(`Render ${problem.render_id}.`);
	return parts.join(' ');
}

/** What the user can do about common errors, shown under the message. */
export function hintFor(status: number, problem: Problem): string | undefined {
	if (status === 401) return 'Check the API key in the credential. Keys start with dda_live_ or dda_test_.';
	if (problem.code === 'insufficient_scope') {
		return 'The API key lacks a permission this operation needs. Create a key with more scopes under API keys in the dashboard.';
	}
	if (problem.code === 'test_key_required') {
		return 'Draft templates and test renders need a test key (dda_test_…).';
	}
	if ((problem.errors ?? []).some((error) => error.path === '/url') && status === 400) {
		return 'Dynamic Document API only delivers webhooks to public https URLs on port 443 (or 80, 8080, 8443). Set WEBHOOK_URL of your n8n instance to such an address.';
	}
	if (status === 429) return 'Too many requests for your plan. Wait a moment or lower the number of parallel items.';
	return problem.doc_url;
}
