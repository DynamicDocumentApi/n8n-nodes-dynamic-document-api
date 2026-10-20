/** This package's version, sent in the User-Agent. A test keeps it equal to package.json. */
export const PACKAGE_VERSION = '0.1.0';

/** Value of `X-Dynamic-Document-Api-Source`: renders count as n8n's and get the 25 s connector budget. */
export const SOURCE = 'n8n';

export const USER_AGENT = `n8n-nodes-dynamic-document-api/${PACKAGE_VERSION}`;

export const CREDENTIALS_NAME = 'dynamicDocumentApiApi';

export const DOCS_URL = 'https://dynamicdocumentapi.com/docs';

/** Lifetime of the signed file links the node asks for: later nodes may read them after the default hour. */
export const FILE_LINK_SECONDS = 86_400;

/** How often a waiting step asks for a render or batch again. */
export const POLL_INTERVAL_MS = 2_000;

/** Default for "Max Wait": n8n has no step limit, but a workflow shouldn't hang on a stuck render. */
export const DEFAULT_MAX_WAIT_SECONDS = 120;

/** The API host of a workspace's region; only `eu` is offered today. */
export function apiBaseUrl(region: unknown): string {
	const code = typeof region === 'string' && /^[a-z]{2}$/.test(region) ? region : 'eu';
	return `https://api-${code}.dynamicdocumentapi.com/v1`;
}
