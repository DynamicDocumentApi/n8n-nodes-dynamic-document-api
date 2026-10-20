import { randomBytes } from 'node:crypto';

import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { CREDENTIALS_NAME, SOURCE, USER_AGENT, apiBaseUrl } from './constants';
import { asProblem, describeProblem, hintFor } from './problem';
import type { Upload } from './types';

export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export interface ApiRequestOptions {
	body?: IDataObject | Buffer;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Sent as `Idempotency-Key`, so a retried node doesn't render twice. */
	idempotencyKey?: string;
	itemIndex?: number;
	/** Answer `null` instead of failing on 404 and 410. */
	allowNotFound?: boolean;
}

interface FullResponse {
	statusCode: number;
	body: unknown;
}

function withoutEmpty(values: IDataObject | undefined): IDataObject | undefined {
	if (!values) return undefined;
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === null || value === '') continue;
		out[key] = value;
	}
	return out;
}

/**
 * A call to the public API with the credential's key. HTTP errors become a `NodeApiError` whose message is the API's
 * problem detail (with field paths), so the workflow shows what to fix.
 */
export async function apiRequest<T>(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: ApiRequestOptions = {},
): Promise<T> {
	const credentials = await this.getCredentials(CREDENTIALS_NAME);
	const headers: IDataObject = {
		Accept: 'application/json',
		'User-Agent': USER_AGENT,
		'X-Dynamic-Document-Api-Source': SOURCE,
		...options.headers,
	};
	if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
	const request: IHttpRequestOptions = {
		method,
		url: `${apiBaseUrl(credentials.region)}${path}`,
		headers,
		qs: withoutEmpty(options.qs),
		json: !Buffer.isBuffer(options.body),
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.body !== undefined) request.body = options.body;

	let response: FullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIALS_NAME,
			request,
		)) as FullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: options.itemIndex });
	}

	if (response.statusCode >= 400) {
		if (options.allowNotFound && (response.statusCode === 404 || response.statusCode === 410)) {
			return null as T;
		}
		const problem = asProblem(response.body);
		throw new NodeApiError(this.getNode(), problem as JsonObject, {
			message: describeProblem(problem, response.statusCode),
			description: hintFor(response.statusCode, problem),
			httpCode: String(response.statusCode),
			itemIndex: options.itemIndex,
		});
	}
	return (typeof response.body === 'string' && response.body.length ? asJson(response.body) : response.body) as T;
}

function asJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Uploads a file for the PDF tools (`POST /v1/uploads`, kept 24 hours) and returns its id. */
export async function uploadFile(
	this: IExecuteFunctions,
	data: Buffer,
	filename: string,
	mimeType: string,
	itemIndex: number,
): Promise<string> {
	const boundary = `----n8nDynamicDocumentApi${randomBytes(12).toString('hex')}`;
	const safeName = filename.replace(/["\r\n]/g, '_') || 'document.pdf';
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
			`Content-Type: ${mimeType || 'application/pdf'}\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	const upload = (await apiRequest.call(this, 'POST', '/uploads', {
		body: Buffer.concat([head, data, tail]),
		headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
		itemIndex,
	})) as Upload;
	return upload.id;
}

/** Downloads a signed file link. Signed links carry their own authorization, so no API key is sent. */
export async function downloadFile(this: IExecuteFunctions, url: string): Promise<Buffer> {
	const data = (await this.helpers.httpRequest({
		method: 'GET',
		url,
		encoding: 'arraybuffer',
		json: false,
		headers: { 'User-Agent': USER_AGENT },
	})) as ArrayBuffer | Buffer;
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}
