/** Document: PDFs from a template, HTML, a web page or Markdown (POST /v1/pdf/from-*). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { createRender, envelope, pdfOptions } from '../../shared/render';
import {
	outputFields,
	pageWait,
	pageWaitFields,
	pdfOptionsField,
	renderOptions,
	show,
	templateDataFields,
	templateData,
	templateLocator,
} from './common';

const R = 'document';

const EINVOICE_PROFILES = [
	{ name: 'XRechnung 3.0 (German Public Sector)', value: 'XRECHNUNG' },
	{ name: 'EN 16931 (Factur-X / ZUGFeRD COMFORT)', value: 'EN16931' },
	{ name: 'EXTENDED', value: 'EXTENDED' },
	{ name: 'BASIC', value: 'BASIC' },
	{ name: 'BASIC WL (No Lines)', value: 'BASIC_WL' },
	{ name: 'MINIMUM (No Lines)', value: 'MINIMUM' },
];

export const documentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'createFromTemplate',
		options: [
			{
				name: 'Create From HTML',
				value: 'createFromHtml',
				description: 'Create a PDF from HTML and CSS',
				action: 'Create a PDF from HTML',
			},
			{
				name: 'Create From Markdown',
				value: 'createFromMarkdown',
				description: 'Create a PDF from Markdown, e.g. text written by an AI step',
				action: 'Create a PDF from markdown',
			},
			{
				name: 'Create From Template',
				value: 'createFromTemplate',
				description: 'Create a PDF from one of your templates and data',
				action: 'Create a PDF from a template',
			},
			{
				name: 'Create From URL',
				value: 'createFromUrl',
				description: 'Create a PDF of a public web page, as a browser prints it',
				action: 'Create a PDF from a URL',
			},
		],
	},

	// Create From Template
	templateLocator(show(R, ['createFromTemplate']), 'The published PDF template to fill'),
	...templateDataFields(R, 'createFromTemplate'),
	{
		displayName: 'E-Invoice',
		name: 'einvoiceMode',
		type: 'options',
		default: 'template',
		options: [
			{ name: "Template's Setting", value: 'template', description: "Embed the template's default e-invoice, if it has one" },
			{ name: 'Embed', value: 'embed', description: 'Make a hybrid PDF/A-3b e-invoice (Growth plan or higher)' },
			{ name: 'Off', value: 'off', description: "A plain PDF, also for a template that has a default e-invoice" },
		],
		displayOptions: show(R, ['createFromTemplate']),
	},
	{
		displayName: 'E-Invoice Profile',
		name: 'einvoiceProfile',
		type: 'options',
		default: 'EN16931',
		options: EINVOICE_PROFILES,
		displayOptions: { show: { resource: [R], operation: ['createFromTemplate'], einvoiceMode: ['embed'] } },
	},
	{
		displayName: 'Invoice From',
		name: 'einvoiceSource',
		type: 'options',
		default: 'path',
		options: [
			{ name: 'A Path in the Template Data', value: 'path' },
			{ name: 'JSON', value: 'json' },
		],
		displayOptions: { show: { resource: [R], operation: ['createFromTemplate'], einvoiceMode: ['embed'] } },
	},
	{
		displayName: 'Invoice Path',
		name: 'einvoicePath',
		type: 'string',
		default: 'invoice',
		description: 'Dotted path of the invoice object inside the template data',
		displayOptions: {
			show: { resource: [R], operation: ['createFromTemplate'], einvoiceMode: ['embed'], einvoiceSource: ['path'] },
		},
	},
	{
		displayName: 'Invoice (JSON)',
		name: 'einvoiceJson',
		type: 'json',
		default: '{}',
		description: 'The invoice as EN 16931 fields, see https://dynamicdocumentapi.com/docs/e-invoicing',
		displayOptions: {
			show: { resource: [R], operation: ['createFromTemplate'], einvoiceMode: ['embed'], einvoiceSource: ['json'] },
		},
	},

	// Create From HTML
	{
		displayName: 'HTML',
		name: 'html',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		placeholder: '<h1>Invoice {{ number }}</h1>',
		description: 'A full HTML document or a fragment. Style and font tags work.',
		displayOptions: show(R, ['createFromHtml']),
	},
	{
		displayName: 'CSS',
		name: 'css',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description: "Extra CSS, added to the document's head (HTML) or on top of the default typography (Markdown)",
		displayOptions: show(R, ['createFromHtml', 'createFromMarkdown']),
	},

	// Create From URL
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/report',
		description: 'A public https page',
		displayOptions: show(R, ['createFromUrl']),
	},
	...pageWaitFields(show(R, ['createFromUrl'])),

	// Create From Markdown
	{
		displayName: 'Markdown',
		name: 'markdown',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		displayOptions: show(R, ['createFromMarkdown']),
	},

	// All operations
	...outputFields(show(R, ['createFromTemplate', 'createFromHtml', 'createFromUrl', 'createFromMarkdown'])),
	pdfOptionsField(show(R, ['createFromTemplate', 'createFromHtml', 'createFromMarkdown'])),
	pdfOptionsField(show(R, ['createFromUrl']), true),
	renderOptions(show(R, ['createFromTemplate', 'createFromHtml', 'createFromUrl', 'createFromMarkdown'])),
];

/** `einvoice` for a template render: left out (template's setting), `null` (off) or a profile with its data. */
function einvoice(this: IExecuteFunctions, itemIndex: number): IDataObject | null | undefined {
	const mode = this.getNodeParameter('einvoiceMode', itemIndex, 'template') as string;
	if (mode === 'template') return undefined;
	if (mode === 'off') return null;
	const profile = this.getNodeParameter('einvoiceProfile', itemIndex) as string;
	if (this.getNodeParameter('einvoiceSource', itemIndex) === 'json') {
		const raw = this.getNodeParameter('einvoiceJson', itemIndex, '{}') as string | IDataObject;
		const invoice = typeof raw === 'string' ? jsonParse<IDataObject>(raw, { errorMessage: 'Invoice (JSON) is not valid JSON' }) : raw;
		return { profile, invoice };
	}
	return { profile, invoice_path: (this.getNodeParameter('einvoicePath', itemIndex, 'invoice') as string) || 'invoice' };
}

function css(value: string): string | undefined {
	// A literal </style> in the CSS would end the element early.
	return value.trim() ? `<style>${value.replace(/<\/style/gi, '<\\/style')}</style>` : undefined;
}

export async function executeDocument(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const pdfValues = this.getNodeParameter('pdfOptions', itemIndex, {}) as IDataObject;
	const body: IDataObject = { ...envelope(options), pdf: pdfOptions(pdfValues) };

	if (operation === 'createFromTemplate') {
		body.template_id = this.getNodeParameter('template', itemIndex, '', { extractValue: true }) as string;
		body.data = templateData.call(this, itemIndex);
		const embedded = einvoice.call(this, itemIndex);
		if (embedded !== undefined) body.einvoice = embedded;
		return [await createRender.call(this, '/pdf/from-template', body, itemIndex)];
	}
	if (operation === 'createFromHtml') {
		body.html = this.getNodeParameter('html', itemIndex) as string;
		body.head = css(this.getNodeParameter('css', itemIndex, '') as string);
		return [await createRender.call(this, '/pdf/from-html', body, itemIndex)];
	}
	if (operation === 'createFromUrl') {
		body.url = (this.getNodeParameter('url', itemIndex) as string).trim();
		const wait = pageWait.call(this, itemIndex);
		if (wait) body.pdf = { ...(body.pdf as IDataObject | undefined), wait };
		return [await createRender.call(this, '/pdf/from-url', body, itemIndex)];
	}
	if (operation === 'createFromMarkdown') {
		body.markdown = this.getNodeParameter('markdown', itemIndex) as string;
		const extraCss = (this.getNodeParameter('css', itemIndex, '') as string).trim();
		if (extraCss) body.css = extraCss;
		return [await createRender.call(this, '/pdf/from-markdown', body, itemIndex)];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
