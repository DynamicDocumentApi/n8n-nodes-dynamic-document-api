/** PDF Tool: merge, split, rotate, protect, unlock, read or change metadata, convert to PDF/A (POST /v1/pdf-tools/*). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { createRender, envelope } from '../../shared/render';
import { outputFields, pdfSource, pdfSourceFields, renderOptions, show, uploadBinary } from './common';

const R = 'pdfTool';
const PRODUCING = ['merge', 'split', 'rotate', 'protect', 'unlock', 'updateMetadata', 'convertToPdfA'];
const SINGLE_SOURCE = ['split', 'rotate', 'protect', 'unlock', 'getMetadata', 'updateMetadata', 'convertToPdfA'];

const PERMISSIONS = [
	{ name: 'Add Comments', value: 'annotate' },
	{ name: 'Change the Document', value: 'modify' },
	{ name: 'Copy Text and Images', value: 'copy' },
	{ name: 'Fill in Forms', value: 'fill_forms' },
	{ name: 'Insert, Rotate or Delete Pages', value: 'assemble' },
	{ name: 'Print', value: 'print' },
	{ name: 'Print in High Resolution', value: 'print_high_res' },
];

export const pdfToolDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'merge',
		options: [
			{ name: 'Convert to PDF/A', value: 'convertToPdfA', description: 'Convert a PDF to archivable PDF/A', action: 'Convert a PDF to PDF/A' },
			{ name: 'Get Metadata', value: 'getMetadata', description: "Read a PDF's pages, page sizes and document information", action: 'Get PDF metadata' },
			{ name: 'Merge', value: 'merge', description: 'Merge PDFs into one, in the order given', action: 'Merge PDF files' },
			{ name: 'Protect', value: 'protect', description: 'Encrypt a PDF with AES-256', action: 'Protect a PDF' },
			{ name: 'Rotate', value: 'rotate', description: 'Turn pages by a multiple of 90 degrees', action: 'Rotate PDF pages' },
			{ name: 'Split', value: 'split', description: 'Split a PDF into several files', action: 'Split a PDF' },
			{ name: 'Unlock', value: 'unlock', description: 'Remove the password from a PDF', action: 'Unlock a PDF' },
			{ name: 'Update Metadata', value: 'updateMetadata', description: "Change a PDF's title, author and other document information", action: 'Update PDF metadata' },
		],
	},

	// Merge
	{
		displayName: 'PDFs',
		name: 'sources',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		placeholder: 'Add PDF',
		required: true,
		description: 'Two or more PDFs, merged in this order (at most 200)',
		displayOptions: show(R, ['merge']),
		options: [
			{
				displayName: 'PDF',
				name: 'pdf',
				values: [
					{
						displayName: 'From',
						name: 'type',
						type: 'options',
						default: 'binary',
						options: [
							{ name: 'Binary Field', value: 'binary', description: 'A PDF from an earlier node' },
							{ name: 'URL', value: 'url', description: 'A public https URL of a PDF' },
							{ name: 'Render', value: 'render', description: 'An earlier render of this workspace' },
						],
					},
					{
						displayName: 'Input Binary Field',
						name: 'binaryProperty',
						type: 'string',
						default: 'data',
						displayOptions: { show: { type: ['binary'] } },
					},
					{
						displayName: 'PDF URL',
						name: 'url',
						type: 'string',
						default: '',
						displayOptions: { show: { type: ['url'] } },
					},
					{
						displayName: 'Render ID',
						name: 'renderId',
						type: 'string',
						default: '',
						displayOptions: { show: { type: ['render'] } },
					},
				],
			},
		],
	},
	{
		displayName: 'Bookmarks',
		name: 'bookmarks',
		type: 'options',
		default: 'filenames',
		options: [
			{ name: 'One Per File, Named After It', value: 'filenames' },
			{ name: 'None', value: 'none' },
		],
		displayOptions: show(R, ['merge']),
	},

	// One input PDF
	...pdfSourceFields('source', show(R, SINGLE_SOURCE)),

	// Split
	{
		displayName: 'Split Into',
		name: 'splitMode',
		type: 'options',
		default: 'every',
		options: [
			{ name: 'Parts of Equal Length', value: 'every' },
			{ name: 'Page Ranges', value: 'ranges' },
		],
		displayOptions: show(R, ['split']),
	},
	{
		displayName: 'Pages per Part',
		name: 'every',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 10000 },
		default: 1,
		displayOptions: { show: { resource: [R], operation: ['split'], splitMode: ['every'] } },
	},
	{
		displayName: 'Parts',
		name: 'ranges',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add part',
		description: 'One output file per part, e.g. 1-3 or 2,4-6',
		displayOptions: { show: { resource: [R], operation: ['split'], splitMode: ['ranges'] } },
		options: [
			{
				displayName: 'Part',
				name: 'part',
				values: [{ displayName: 'Pages', name: 'pages', type: 'string', default: '', placeholder: '1-3' }],
			},
		],
	},
	{
		displayName: 'As One ZIP',
		name: 'zip',
		type: 'boolean',
		default: false,
		description: 'Whether to deliver one ZIP file holding the parts instead of one file per part',
		displayOptions: show(R, ['split']),
	},

	// Rotate
	{
		displayName: 'Degrees',
		name: 'degrees',
		type: 'options',
		default: 90,
		options: [
			{ name: '90° Clockwise', value: 90 },
			{ name: '180°', value: 180 },
			{ name: '270° Clockwise', value: 270 },
			{ name: '90° Anticlockwise', value: -90 },
		],
		displayOptions: show(R, ['rotate']),
	},
	{
		displayName: 'Pages',
		name: 'pages',
		type: 'string',
		default: 'all',
		placeholder: '2,4-',
		description: 'The pages to turn, e.g. all, 1-3 or 2,4-',
		displayOptions: show(R, ['rotate']),
	},

	// Protect
	{
		displayName: 'Password to Open',
		name: 'userPassword',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		description: 'Readers need it to open the PDF. Leave empty for a PDF that opens without one.',
		displayOptions: show(R, ['protect']),
	},
	{
		displayName: 'Owner Password',
		name: 'ownerPassword',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		description: 'Lifts the limits below. Set at least one of the two passwords.',
		displayOptions: show(R, ['protect']),
	},
	{
		displayName: 'Allowed',
		name: 'permissions',
		type: 'multiOptions',
		default: [],
		options: PERMISSIONS,
		description: 'What readers without the owner password may do. Leave empty for print, copy and fill in forms.',
		displayOptions: show(R, ['protect']),
	},

	// Unlock
	{
		displayName: 'Password',
		name: 'password',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		required: true,
		description: "The PDF's password",
		displayOptions: show(R, ['unlock']),
	},

	// Update Metadata
	{
		displayName: 'Metadata',
		name: 'metadataFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: show(R, ['updateMetadata']),
		options: [
			{ displayName: 'Author', name: 'author', type: 'string', default: '' },
			{ displayName: 'Creator', name: 'creator', type: 'string', default: '' },
			{ displayName: 'Keywords', name: 'keywords', type: 'string', default: '', description: 'Comma-separated' },
			{ displayName: 'Language', name: 'lang', type: 'string', default: '', placeholder: 'en-GB' },
			{ displayName: 'Subject', name: 'subject', type: 'string', default: '' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		],
	},

	// Convert to PDF/A
	{
		displayName: 'Level',
		name: 'level',
		type: 'options',
		default: '2b',
		options: [
			{ name: 'PDF/A-2b', value: '2b' },
			{ name: 'PDF/A-3b (Allows Attachments)', value: '3b' },
		],
		displayOptions: show(R, ['convertToPdfA']),
	},

	...outputFields(show(R, PRODUCING)),
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(R, ['getMetadata']),
	},
	renderOptions(show(R, PRODUCING)),
];

async function mergeSources(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const rows =
		(this.getNodeParameter('sources', itemIndex, {}) as {
			pdf?: Array<{ type?: string; binaryProperty?: string; url?: string; renderId?: string }>;
		}).pdf ?? [];
	const sources: IDataObject[] = [];
	for (const row of rows) {
		if (row.type === 'url' && row.url?.trim()) sources.push({ url: row.url.trim() });
		else if (row.type === 'render' && row.renderId?.trim()) sources.push({ render_id: row.renderId.trim() });
		else if (row.type === 'binary' || row.type === undefined) {
			sources.push({ upload_id: await uploadBinary.call(this, row.binaryProperty || 'data', itemIndex) });
		}
	}
	if (sources.length < 2) {
		throw new NodeOperationError(this.getNode(), 'Add at least two PDFs to merge.', { itemIndex });
	}
	return sources;
}

export async function executePdfTool(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const body: IDataObject = { ...envelope(options) };

	if (operation === 'merge') {
		body.sources = await mergeSources.call(this, itemIndex);
		body.bookmarks = this.getNodeParameter('bookmarks', itemIndex, 'filenames') as string;
		return [await createRender.call(this, '/pdf-tools/merge', body, itemIndex)];
	}

	body.source = await pdfSource.call(this, 'source', itemIndex);

	if (operation === 'split') {
		if (this.getNodeParameter('splitMode', itemIndex) === 'ranges') {
			const parts = ((this.getNodeParameter('ranges', itemIndex, {}) as { part?: Array<{ pages?: string }> }).part ?? [])
				.map((part) => part.pages?.trim())
				.filter((pages): pages is string => !!pages);
			if (!parts.length) throw new NodeOperationError(this.getNode(), 'Add at least one part with pages.', { itemIndex });
			body.ranges = parts;
		} else {
			body.every = this.getNodeParameter('every', itemIndex) as number;
		}
		body.zip = this.getNodeParameter('zip', itemIndex, false) as boolean;
		return [await createRender.call(this, '/pdf-tools/split', body, itemIndex)];
	}
	if (operation === 'rotate') {
		body.degrees = this.getNodeParameter('degrees', itemIndex) as number;
		body.pages = (this.getNodeParameter('pages', itemIndex, 'all') as string) || 'all';
		return [await createRender.call(this, '/pdf-tools/rotate', body, itemIndex)];
	}
	if (operation === 'protect') {
		const userPassword = this.getNodeParameter('userPassword', itemIndex, '') as string;
		const ownerPassword = this.getNodeParameter('ownerPassword', itemIndex, '') as string;
		if (!userPassword && !ownerPassword) {
			throw new NodeOperationError(this.getNode(), 'Set a password to open, an owner password, or both.', { itemIndex });
		}
		if (userPassword) body.user_password = userPassword;
		if (ownerPassword) body.owner_password = ownerPassword;
		const allowed = this.getNodeParameter('permissions', itemIndex, []) as string[];
		if (allowed.length) {
			body.permissions = Object.fromEntries(PERMISSIONS.map((p) => [p.value, allowed.includes(p.value)]));
		}
		return [await createRender.call(this, '/pdf-tools/protect', body, itemIndex)];
	}
	if (operation === 'unlock') {
		body.password = this.getNodeParameter('password', itemIndex) as string;
		return [await createRender.call(this, '/pdf-tools/unlock', body, itemIndex)];
	}
	if (operation === 'getMetadata') {
		// A read returns no file: the information is in the render's `result`.
		return [await createRender.call(this, '/pdf-tools/metadata', { source: body.source }, itemIndex)];
	}
	if (operation === 'updateMetadata') {
		const fields = this.getNodeParameter('metadataFields', itemIndex, {}) as IDataObject;
		const set: IDataObject = {};
		for (const key of ['title', 'author', 'subject', 'creator', 'lang']) {
			if (typeof fields[key] === 'string' && fields[key] !== '') set[key] = fields[key];
		}
		if (typeof fields.keywords === 'string' && fields.keywords.trim()) {
			set.keywords = fields.keywords
				.split(',')
				.map((keyword) => keyword.trim())
				.filter((keyword) => keyword !== '');
		}
		if (!Object.keys(set).length) {
			throw new NodeOperationError(this.getNode(), 'Add at least one metadata field to change.', { itemIndex });
		}
		body.set = set;
		return [await createRender.call(this, '/pdf-tools/metadata', body, itemIndex)];
	}
	if (operation === 'convertToPdfA') {
		body.level = this.getNodeParameter('level', itemIndex) as string;
		return [await createRender.call(this, '/pdf-tools/pdfa', body, itemIndex)];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
