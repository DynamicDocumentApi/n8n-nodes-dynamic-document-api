/**
 * What every render operation shares: the request envelope from the node's options, waiting for a render that
 * outlived the 25 s connector budget, the simplified output, and the files as binary data.
 */
import type { IBinaryKeyData, IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { DEFAULT_MAX_WAIT_SECONDS, FILE_LINK_SECONDS, POLL_INTERVAL_MS } from './constants';
import { apiRequest, downloadFile } from './transport';
import type { Batch, BatchFile, Render, RenderFile } from './types';

const DONE = new Set(['succeeded', 'failed', 'canceled', 'expired']);
const BATCH_DONE = new Set(['completed', 'failed', 'canceled']);

const MIME_TYPES: Record<string, string> = {
	pdf: 'application/pdf',
	png: 'image/png',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	webp: 'image/webp',
	zip: 'application/zip',
	xml: 'application/xml',
	html: 'text/html',
	json: 'application/json',
};

export function mimeTypeFor(format: string | undefined, filename: string): string {
	const key = (format || filename.split('.').pop() || '').toLowerCase();
	return MIME_TYPES[key] ?? 'application/octet-stream';
}

/** `Idempotency-Key` for one item of one node in one execution, so "Retry On Fail" doesn't render twice. */
export function idempotencyKey(context: IExecuteFunctions, itemIndex: number): string | undefined {
	const execution = context.getExecutionId();
	if (!execution) return undefined;
	return `n8n-${execution}-${context.getNode().id}-${itemIndex}`;
}

function text(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	const s = String(value).trim();
	return s === '' ? undefined : s;
}

/** Key/value pairs of a `metadata` fixed collection. */
export function keyValues(collection: unknown): IDataObject | undefined {
	const rows = (collection as { values?: Array<{ key?: string; value?: unknown }> } | undefined)?.values ?? [];
	const out: IDataObject = {};
	for (const row of rows) {
		const key = text(row.key);
		if (key) out[key] = (row.value ?? '') as string;
	}
	return Object.keys(out).length ? out : undefined;
}

/** File name, reference, metadata and the link lifetime from the operation's "Options". */
export function envelope(options: IDataObject, includeFilename = true): IDataObject {
	const body: IDataObject = { delivery: { expires_in: FILE_LINK_SECONDS } };
	const filename = text(options.fileName);
	if (includeFilename && filename) body.filename = filename;
	const reference = text(options.reference);
	if (reference) body.reference = reference;
	const metadata = keyValues(options.metadata);
	if (metadata) body.metadata = metadata;
	return body;
}

/** The `pdf` object from the "PDF Options" collection, or `undefined` when nothing is set. */
export function pdfOptions(values: IDataObject): IDataObject | undefined {
	const pdf: IDataObject = {};
	const size = text(values.paperSize);
	if (size) pdf.paper = { size };
	const orientation = text(values.orientation);
	if (orientation) pdf.orientation = orientation;
	const margin = text(values.margin);
	if (margin) pdf.margin = { top: margin, right: margin, bottom: margin, left: margin };
	const header = text(values.headerHtml);
	if (header) pdf.header = { enabled: true, html: header };
	const footer = text(values.footerHtml);
	if (footer) pdf.footer = { enabled: true, html: footer };
	const pageRanges = text(values.pageRanges);
	if (pageRanges) pdf.page_ranges = pageRanges;
	if (typeof values.scale === 'number' && values.scale > 0) pdf.scale = values.scale;
	for (const [option, key] of [
		['printBackground', 'print_background'],
		['outline', 'outline'],
		['tagged', 'tagged'],
		['singlePage', 'single_page'],
	] as const) {
		if (typeof values[option] === 'boolean') pdf[key] = values[option];
	}
	const pdfa = text(values.pdfA);
	if (pdfa) pdf.pdfa = pdfa;
	if (values.pdfUa === true) pdf.pdfua = '1';
	const media = text(values.emulateMedia);
	if (media) pdf.emulate_media = media;
	return Object.keys(pdf).length ? pdf : undefined;
}

/** `format` and the `image` object from the "Image Options" collection. */
export function imageOptions(values: IDataObject): { format?: string; image?: IDataObject } {
	const image: IDataObject = {};
	for (const [option, key] of [
		['width', 'width'],
		['height', 'height'],
		['scale', 'scale'],
	] as const) {
		if (typeof values[option] === 'number' && (values[option] as number) > 0) image[key] = values[option];
	}
	if (typeof values.fullPage === 'boolean') image.full_page = values.fullPage;
	if (typeof values.transparent === 'boolean') image.transparent = values.transparent;
	const fit = text(values.fit);
	if (fit) image.fit = fit;
	if (typeof values.quality === 'number' && values.quality > 0) image.format_options = { quality: values.quality };
	return {
		format: text(values.format),
		image: Object.keys(image).length ? image : undefined,
	};
}

/** How a render operation hands back its result, from the node's output parameters. */
export interface OutputSettings {
	download: boolean;
	binaryPropertyName: string;
	simplify: boolean;
	wait: boolean;
	maxWaitSeconds: number;
	/** Fail the item for a failed render (creating), or return it like any other render (getting). */
	failOnError?: boolean;
}

export function outputSettings(context: IExecuteFunctions, itemIndex: number): OutputSettings {
	const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
	return {
		download: context.getNodeParameter('download', itemIndex, true) as boolean,
		binaryPropertyName: (context.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string) || 'data',
		simplify: context.getNodeParameter('simplify', itemIndex, true) as boolean,
		wait: options.waitForCompletion !== false,
		maxWaitSeconds:
			typeof options.maxWaitSeconds === 'number' ? options.maxWaitSeconds : DEFAULT_MAX_WAIT_SECONDS,
	};
}

/** Asks for the render again until it is done or `maxWaitSeconds` have passed. */
export async function waitForRender(
	this: IExecuteFunctions,
	render: Render,
	maxWaitSeconds: number,
	itemIndex: number,
): Promise<Render> {
	let current = render;
	const deadline = Date.now() + maxWaitSeconds * 1000;
	while (!DONE.has(current.status) && Date.now() + POLL_INTERVAL_MS <= deadline) {
		await sleep(POLL_INTERVAL_MS);
		current = (await apiRequest.call(this, 'GET', `/renders/${encodeURIComponent(current.id)}`, {
			itemIndex,
		})) as Render;
	}
	return current;
}

export function simplifyRender(render: Render): IDataObject {
	const first = render.files?.[0];
	const out: IDataObject = {
		id: render.id,
		status: render.status,
		test: render.test,
		filename: first?.filename ?? null,
		file_url: first?.url ?? null,
		file_url_expires_at: first?.url_expires_at ?? null,
		pages: render.pages ?? null,
		billed_renders: render.billed_renders ?? null,
		reference: render.reference ?? null,
		warnings: (render.warnings ?? []).map((warning) => `${warning.code}: ${warning.message}`),
		error_code: render.error?.code ?? null,
		error_message: render.error?.message ?? null,
		created_at: render.created_at,
		completed_at: render.completed_at ?? null,
	};
	if ((render.files?.length ?? 0) > 1) {
		out.files = render.files.map((file) => ({ filename: file.filename, url: file.url ?? null, pages: file.pages ?? null }));
	}
	if (render.result) out.result = render.result as IDataObject;
	if (!DONE.has(render.status)) {
		out.hint = 'Still running. Use Render → Wait, or start the next steps from the Dynamic Document API Trigger.';
	}
	return out;
}

/** Downloads each file with a link: the first into `property`, further ones into `property_2`, `property_3` … */
export async function filesAsBinary(
	this: IExecuteFunctions,
	files: Array<RenderFile | BatchFile>,
	property: string,
): Promise<IBinaryKeyData | undefined> {
	const binary: IBinaryKeyData = {};
	let n = 0;
	for (const file of files) {
		if (!file.url) continue;
		const buffer = await downloadFile.call(this, file.url);
		const format = 'format' in file ? file.format : undefined;
		const key = n === 0 ? property : `${property}_${n + 1}`;
		binary[key] = await this.helpers.prepareBinaryData(buffer, file.filename, mimeTypeFor(format, file.filename));
		n++;
	}
	return n ? binary : undefined;
}

/**
 * The node's result for a render: waits if asked, fails the item for a failed render, and adds the files as binary
 * data when "Download File" is on.
 */
export async function finishRender(
	this: IExecuteFunctions,
	initial: Render,
	itemIndex: number,
	settings: OutputSettings,
): Promise<INodeExecutionData> {
	const render =
		settings.wait && !DONE.has(initial.status)
			? await waitForRender.call(this, initial, settings.maxWaitSeconds, itemIndex)
			: initial;
	if (render.status === 'failed' && settings.failOnError !== false) {
		const reason = render.error ? `${render.error.code}: ${render.error.message}` : 'no error details';
		throw new NodeApiError(this.getNode(), (render.error ?? {}) as JsonObject, {
			message: `Render ${render.id} failed (${reason}).`,
			itemIndex,
		});
	}
	if ((render.status === 'canceled' || render.status === 'expired') && settings.failOnError !== false) {
		throw new NodeOperationError(this.getNode(), `Render ${render.id} is ${render.status}.`, { itemIndex });
	}
	const item: INodeExecutionData = {
		json: settings.simplify ? simplifyRender(render) : (render as unknown as IDataObject),
		pairedItem: { item: itemIndex },
	};
	if (settings.download && render.status === 'succeeded') {
		const binary = await filesAsBinary.call(this, render.files ?? [], settings.binaryPropertyName);
		if (binary) item.binary = binary;
	}
	return item;
}

/** Sends a render request and returns the node's result for it. */
export async function createRender(
	this: IExecuteFunctions,
	path: string,
	body: IDataObject,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const render = (await apiRequest.call(this, 'POST', path, {
		body,
		idempotencyKey: idempotencyKey(this, itemIndex),
		itemIndex,
	})) as Render;
	return finishRender.call(this, render, itemIndex, outputSettings(this, itemIndex));
}

export function isBatchDone(batch: Batch): boolean {
	return BATCH_DONE.has(batch.status);
}

/** Asks for the batch again until it is done or `maxWaitSeconds` have passed. */
export async function waitForBatch(
	this: IExecuteFunctions,
	batch: Batch,
	maxWaitSeconds: number,
	itemIndex: number,
): Promise<Batch> {
	let current = batch;
	const deadline = Date.now() + maxWaitSeconds * 1000;
	while (!isBatchDone(current) && Date.now() + POLL_INTERVAL_MS <= deadline) {
		await sleep(POLL_INTERVAL_MS);
		current = (await apiRequest.call(this, 'GET', `/batches/${encodeURIComponent(current.id)}`, {
			itemIndex,
		})) as Batch;
	}
	return current;
}
