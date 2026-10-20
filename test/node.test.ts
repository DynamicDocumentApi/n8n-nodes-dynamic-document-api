import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions, INodeExecutionData } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DynamicDocumentApi } from '../nodes/DynamicDocumentApi/DynamicDocumentApi.node';
import { getTemplateFields, searchTemplates } from '../nodes/shared/methods';
import { type Handler, type RecordedCall, fakeContext, render } from './context';

// A virtual clock: waiting steps sleep without real delays.
let clock = 0;
vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return {
		...actual,
		sleep: vi.fn(async (ms: number) => {
			clock += ms;
		}),
	};
});

beforeEach(() => {
	clock = 0;
	vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
	vi.restoreAllMocks();
});

const API = 'https://api-eu.dynamicdocumentapi.com/v1';
const PDF = Buffer.from('%PDF-1.7 test');

async function run(parameters: Record<string, unknown>, handler: Handler, items?: INodeExecutionData[]) {
	const context = fakeContext({ parameters, handler, items });
	const [output] = await new DynamicDocumentApi().execute.call(context as unknown as IExecuteFunctions);
	return { output: output!, calls: context.calls };
}

/** Answers API calls by `METHOD path`, downloads with the PDF bytes. */
function routes(table: Record<string, (call: RecordedCall) => { statusCode: number; body?: unknown }>): Handler {
	return (call) => {
		if (!call.authenticated) return PDF;
		const key = `${call.method} ${call.url.replace(API, '')}`;
		const route = table[key];
		if (!route) throw new Error(`Unexpected call ${key}`);
		return route(call);
	};
}

const TEMPLATE = { mode: 'list', value: 'tpl_1' };

describe('Document → Create From Template', () => {
	it('sends the mapped data, the link lifetime and an idempotency key, and adds the PDF as binary', async () => {
		const { output, calls } = await run(
			{
				resource: 'document',
				operation: 'createFromTemplate',
				template: TEMPLATE,
				dataMode: 'mapEachField',
				templateData: {
					mappingMode: 'defineBelow',
					value: { 'customer.name': 'Ada', total: '12' },
					schema: [
						{ id: 'customer.name', displayName: 'Customer › Name', type: 'string' },
						{ id: 'total', displayName: 'Total', type: 'number' },
					],
				},
				einvoiceMode: 'off',
				options: { fileName: 'invoice.pdf', reference: 'order-1' },
				pdfOptions: { paperSize: 'A4' },
			},
			routes({ 'POST /pdf/from-template': () => ({ statusCode: 200, body: render() }) }),
		);
		const [create] = calls;
		expect(create!.body).toEqual({
			template_id: 'tpl_1',
			data: { customer: { name: 'Ada' }, total: 12 },
			einvoice: null,
			filename: 'invoice.pdf',
			reference: 'order-1',
			delivery: { expires_in: 86400 },
			pdf: { paper: { size: 'A4' } },
		});
		// Execution, node and item: a retried node sends the same key.
		const expectedKey = ['n8n', 'exec-1', 'node-1', '0'].join('-');
		expect(create!.headers['X-Dynamic-Document-Api-Source']).toBe('n8n');
		expect(create!.headers['Idempotency-Key']).toBe(expectedKey);
		expect(calls[1]).toMatchObject({ method: 'GET', authenticated: false });
		expect(output[0]!.json).toMatchObject({ id: 'rnd_1', status: 'succeeded', filename: 'invoice.pdf' });
		expect(output[0]!.binary?.data).toMatchObject({ fileName: 'invoice.pdf', mimeType: 'application/pdf' });
		expect(Buffer.from(output[0]!.binary!.data!.data, 'base64')).toEqual(PDF);
		expect(output[0]!.pairedItem).toEqual({ item: 0 });
	});

	it('embeds an e-invoice from a path or JSON, and keeps the template setting by default', async () => {
		const bodies: IDataObject[] = [];
		const handler = routes({
			'POST /pdf/from-template': (call) => {
				bodies.push(call.body as IDataObject);
				return { statusCode: 200, body: render() };
			},
		});
		const base = { resource: 'document', operation: 'createFromTemplate', template: TEMPLATE, dataMode: 'json', dataJson: '{"a":1}', download: false };
		await run({ ...base, einvoiceMode: 'embed', einvoiceProfile: 'XRECHNUNG', einvoiceSource: 'path', einvoicePath: 'invoice' }, handler);
		await run({ ...base, einvoiceMode: 'embed', einvoiceProfile: 'EN16931', einvoiceSource: 'json', einvoiceJson: '{"number":"1"}' }, handler);
		await run({ ...base, einvoiceMode: 'template' }, handler);
		expect(bodies[0]!.einvoice).toEqual({ profile: 'XRECHNUNG', invoice_path: 'invoice' });
		expect(bodies[1]!.einvoice).toEqual({ profile: 'EN16931', invoice: { number: '1' } });
		expect('einvoice' in bodies[2]!).toBe(false);
		expect(bodies[2]!.data).toEqual({ a: 1 });
	});

	it('waits for a render that outlived the 25-second budget', async () => {
		let polls = 0;
		const { output } = await run(
			{ resource: 'document', operation: 'createFromHtml', html: '<h1>x</h1>', download: false },
			routes({
				'POST /pdf/from-html': () => ({ statusCode: 202, body: render({ status: 'processing', files: [] }) }),
				'GET /renders/rnd_1': () => ({ statusCode: 200, body: ++polls < 3 ? render({ status: 'processing', files: [] }) : render() }),
			}),
		);
		expect(polls).toBe(3);
		expect(output[0]!.json.status).toBe('succeeded');
	});

	it('returns a still-running render with a hint after the max wait', async () => {
		const { output } = await run(
			{ resource: 'document', operation: 'createFromHtml', html: '<p>slow</p>', options: { maxWaitSeconds: 10 } },
			routes({
				'POST /pdf/from-html': () => ({ statusCode: 202, body: render({ status: 'processing', files: [] }) }),
				'GET /renders/rnd_1': () => ({ statusCode: 200, body: render({ status: 'processing', files: [] }) }),
			}),
		);
		expect(output[0]!.json).toMatchObject({ status: 'processing', hint: expect.stringContaining('Render → Wait') });
		expect(output[0]!.binary).toBeUndefined();
	});

	it("fails the item with the API's problem detail", async () => {
		await expect(
			run(
				{ resource: 'document', operation: 'createFromUrl', url: 'https://example.com', waitUntil: 'load' },
				routes({
					'POST /pdf/from-url': () => ({
						statusCode: 422,
						body: { detail: 'The page could not be loaded.', code: 'render_failed', render_id: 'rnd_7' },
					}),
				}),
			),
		).rejects.toThrow('The page could not be loaded. Render rnd_7.');
	});

	it('puts the wait condition and CSS where the API expects them', async () => {
		const bodies: IDataObject[] = [];
		const handler = routes({
			'POST /pdf/from-url': (call) => (bodies.push(call.body as IDataObject), { statusCode: 200, body: render() }),
			'POST /pdf/from-markdown': (call) => (bodies.push(call.body as IDataObject), { statusCode: 200, body: render() }),
		});
		await run({ resource: 'document', operation: 'createFromUrl', url: ' https://example.com ', waitUntil: 'selector', waitSelector: '#ready', download: false }, handler);
		await run({ resource: 'document', operation: 'createFromMarkdown', markdown: '# Hi', css: 'h1{color:red}', download: false }, handler);
		expect(bodies[0]).toMatchObject({ url: 'https://example.com', pdf: { wait: { until: 'selector', selector: '#ready' } } });
		expect(bodies[1]).toMatchObject({ markdown: '# Hi', css: 'h1{color:red}' });
	});
});

describe('Image', () => {
	it('sends the format and image options', async () => {
		const { calls } = await run(
			{
				resource: 'image',
				operation: 'createFromTemplate',
				template: TEMPLATE,
				dataMode: 'mapEachField',
				templateData: { value: { 'title.text': 'Hello' }, schema: [{ id: 'title.text', type: 'string' }] },
				imageOptions: { format: 'webp', width: 1200, height: 630 },
				download: false,
			},
			routes({ 'POST /images/from-template': () => ({ statusCode: 200, body: render() }) }),
		);
		expect(calls[0]!.body).toMatchObject({
			template_id: 'tpl_1',
			data: { title: { text: 'Hello' } },
			format: 'webp',
			image: { width: 1200, height: 630 },
		});
	});
});

describe('PDF Tool', () => {
	it('uploads binary inputs and merges them in order', async () => {
		const uploads: Buffer[] = [];
		const { calls } = await run(
			{
				resource: 'pdfTool',
				operation: 'merge',
				sources: { pdf: [{ type: 'binary', binaryProperty: 'data' }, { type: 'url', url: 'https://example.com/b.pdf' }, { type: 'render', renderId: 'rnd_9' }] },
				bookmarks: 'none',
				download: false,
			},
			routes({
				'POST /uploads': (call) => {
					uploads.push(call.body as Buffer);
					return { statusCode: 201, body: { id: 'upl_1', filename: 'a.pdf' } };
				},
				'POST /pdf-tools/merge': () => ({ statusCode: 200, body: render() }),
			}),
			[{ json: {}, binary: { data: { data: PDF.toString('base64'), mimeType: 'application/pdf', fileName: 'a.pdf' } } }],
		);
		expect(String(uploads[0])).toContain('filename="a.pdf"');
		expect(uploads[0]!.includes(PDF)).toBe(true);
		expect(String(calls[0]!.headers['Content-Type'])).toMatch(/^multipart\/form-data; boundary=/);
		expect(calls[1]!.body).toMatchObject({
			sources: [{ upload_id: 'upl_1' }, { url: 'https://example.com/b.pdf' }, { render_id: 'rnd_9' }],
			bookmarks: 'none',
		});
	});

	it('needs two PDFs to merge and a password to protect', async () => {
		await expect(
			run({ resource: 'pdfTool', operation: 'merge', sources: { pdf: [{ type: 'url', url: 'https://example.com/a.pdf' }] } }, routes({})),
		).rejects.toThrow('at least two PDFs');
		await expect(
			run({ resource: 'pdfTool', operation: 'protect', sourceType: 'render', sourceRenderId: 'rnd_1' }, routes({})),
		).rejects.toThrow('Set a password');
	});

	it('sends permissions, metadata changes, rotation and split ranges', async () => {
		const bodies: Record<string, IDataObject> = {};
		const handler: Handler = (call) => {
			if (!call.authenticated) return PDF;
			bodies[call.url.replace(API, '')] = call.body as IDataObject;
			return { statusCode: 200, body: render() };
		};
		const source = { sourceType: 'url', sourceUrl: 'https://example.com/a.pdf', download: false };
		await run({ resource: 'pdfTool', operation: 'protect', ...source, ownerPassword: 'owner', permissions: ['print'] }, handler);
		await run({ resource: 'pdfTool', operation: 'updateMetadata', ...source, metadataFields: { title: 'Q3', keywords: 'a, b' } }, handler);
		await run({ resource: 'pdfTool', operation: 'rotate', ...source, degrees: 90, pages: '2,4-' }, handler);
		await run({ resource: 'pdfTool', operation: 'split', ...source, splitMode: 'ranges', ranges: { part: [{ pages: '1-2' }, { pages: '3-' }] }, zip: true }, handler);
		expect(bodies['/pdf-tools/protect']).toMatchObject({ owner_password: 'owner', permissions: { print: true, copy: false } });
		expect(bodies['/pdf-tools/metadata']).toMatchObject({ set: { title: 'Q3', keywords: ['a', 'b'] } });
		expect(bodies['/pdf-tools/rotate']).toMatchObject({ degrees: 90, pages: '2,4-', source: { url: 'https://example.com/a.pdf' } });
		expect(bodies['/pdf-tools/split']).toMatchObject({ ranges: ['1-2', '3-'], zip: true });
	});
});

describe('Batch, Render, Template, Signed Link, Account', () => {
	it('creates a batch, wrapping plain items as data', async () => {
		const { calls, output } = await run(
			{ resource: 'batch', operation: 'create', template: TEMPLATE, items: '[{"name":"Ada"},{"data":{"name":"Grace"},"filename":"g.pdf"}]', combine: 'zip', zipFilename: 'all.zip' },
			routes({ 'POST /batches': () => ({ statusCode: 202, body: { id: 'bat_1', object: 'batch', status: 'queued', total: 2, test: true, created_at: '' } }) }),
		);
		expect(calls[0]!.body).toMatchObject({
			template_id: 'tpl_1',
			items: [{ data: { name: 'Ada' } }, { data: { name: 'Grace' }, filename: 'g.pdf' }],
			combine: { zip: true, zip_filename: 'all.zip' },
		});
		expect(output[0]!.json.id).toBe('bat_1');
	});

	it('lists renders across pages with filters', async () => {
		let page = 0;
		const { output, calls } = await run(
			{ resource: 'render', operation: 'getAll', returnAll: true, filters: { status: ['succeeded', 'failed'], source: 'n8n' } },
			routes({
				'GET /renders': () => ({
					statusCode: 200,
					body: page++ === 0 ? { data: [render()], has_more: true, next_cursor: 'c2' } : { data: [render({ id: 'rnd_2' })], has_more: false },
				}),
			}),
		);
		expect(output.map((item) => item.json.id)).toEqual(['rnd_1', 'rnd_2']);
		expect(calls[0]!.qs).toMatchObject({ status: 'succeeded,failed', source: 'n8n' });
		expect(calls[1]!.qs).toMatchObject({ cursor: 'c2' });
	});

	it('returns a failed render from Get instead of failing, and confirms deleted files', async () => {
		const { output } = await run(
			{ resource: 'render', operation: 'get', renderId: 'rnd_1', download: true },
			routes({ 'GET /renders/rnd_1': () => ({ statusCode: 200, body: render({ status: 'failed', files: [], error: { code: 'x', message: 'boom' } }) }) }),
		);
		expect(output[0]!.json).toMatchObject({ status: 'failed', error_message: 'boom' });
		const deleted = await run(
			{ resource: 'render', operation: 'deleteFiles', renderId: 'rnd_1' },
			routes({ 'DELETE /renders/rnd_1/files': () => ({ statusCode: 200, body: render({ status: 'expired', files: [] }) }) }),
		);
		expect(deleted.output[0]!.json).toEqual({ deleted: true, id: 'rnd_1', status: 'expired' });
	});

	it('signs a URL with parameters and an expiry', async () => {
		const { calls, output } = await run(
			{ resource: 'signedLink', operation: 'sign', link: { mode: 'list', value: 'lnk_1' }, format: 'png', params: { values: [{ key: 'title.text', value: 'Hi' }] }, options: { expiresAt: '2026-10-21T00:00:00Z' } },
			routes({ 'POST /signed-links/lnk_1/sign': () => ({ statusCode: 200, body: { url: 'https://img.example.com/l/lnk_1/render.png?sig=x' } }) }),
		);
		expect(calls[0]!.body).toEqual({ format: 'png', params: { 'title.text': 'Hi' }, expires_at: 1792540800 });
		expect(output[0]!.json).toMatchObject({ url: expect.stringContaining('sig=x'), link_id: 'lnk_1', expires_at: '2026-10-21T00:00:00.000Z' });
	});

	it('asks for usage by day and gets the account', async () => {
		const { calls } = await run(
			{ resource: 'account', operation: 'getUsage', from: '2026-10-01T10:00:00Z', to: '', options: { granularity: 'day' } },
			routes({ 'GET /usage': () => ({ statusCode: 200, body: { data: [] } }) }),
		);
		expect(calls[0]!.qs).toEqual({ from: '2026-10-01', granularity: 'day' });
		const account = await run({ resource: 'account', operation: 'get' }, routes({ 'GET /account': () => ({ statusCode: 200, body: { workspace: { name: 'W' } } }) }));
		expect(account.output[0]!.json).toEqual({ workspace: { name: 'W' } });
	});

	it('lists published templates of the right type and loads their fields', async () => {
		const context = fakeContext({
			parameters: { resource: 'image', template: { mode: 'list', value: 'tpl_1' } },
			handler: routes({
				'GET /templates': () => ({
					statusCode: 200,
					body: {
						data: [
							{ id: 'tpl_1', name: 'Card', type: 'image_canvas', live_version: { id: 'v', number: 1 } },
							{ id: 'tpl_2', name: 'Draft', type: 'image_canvas', live_version: null },
						],
						has_more: false,
					},
				}),
				'GET /templates/tpl_1/schema': () => ({ statusCode: 200, body: { dynamic_properties: [{ key: 'title.text', type: 'string' }] } }),
			}),
		});
		const list = await searchTemplates.call(context as unknown as ILoadOptionsFunctions, 'ca');
		expect(list.results).toEqual([{ name: 'Card (Image)', value: 'tpl_1' }]);
		expect(context.calls[0]!.qs).toMatchObject({ q: 'ca', type: 'image_canvas' });
		const fields = await getTemplateFields.call(context as unknown as ILoadOptionsFunctions);
		expect(fields.fields.map((field) => field.id)).toEqual(['title.text']);
	});
});
