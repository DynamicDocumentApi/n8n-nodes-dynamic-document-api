/** Parameters several operations share: template choice and data, options, output and PDF sources. */
import type {
	IDataObject,
	IDisplayOptions,
	IExecuteFunctions,
	INodeProperties,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { DEFAULT_MAX_WAIT_SECONDS, DOCS_URL } from '../../shared/constants';
import { dataFromMappedValues } from '../../shared/fields';
import { uploadFile } from '../../shared/transport';

export function show(resource: string, operation: string[]): IDisplayOptions {
	return { show: { resource: [resource], operation } };
}

export const PAPER_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B4', 'B5', 'Letter', 'Legal', 'Tabloid', 'Ledger'];

export function templateLocator(displayOptions: IDisplayOptions, description: string): INodeProperties {
	return {
		displayName: 'Template',
		name: 'template',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description,
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTemplates', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'tpl_01J9ZK…',
				validation: [
					{
						type: 'regex',
						properties: { regex: 'tpl_[0-9A-Za-z]+', errorMessage: 'A template ID starts with tpl_' },
					},
				],
			},
		],
	};
}

/** "Data Entry": the template's fields, or the whole `data` object as JSON. */
export function templateDataFields(resource: string, operation: string): INodeProperties[] {
	return [
		{
			displayName: 'Data Entry',
			name: 'dataMode',
			type: 'options',
			noDataExpression: true,
			default: 'mapEachField',
			options: [
				{
					name: 'Map Each Field',
					value: 'mapEachField',
					description: "Fill in the template's data fields one by one",
				},
				{
					name: 'Using JSON',
					value: 'json',
					description: "Send the whole data object, for example the previous node's output as an expression",
				},
			],
			displayOptions: show(resource, [operation]),
		},
		{
			displayName: 'Template Data',
			name: 'templateData',
			type: 'resourceMapper',
			noDataExpression: true,
			default: { mappingMode: 'defineBelow', value: null },
			required: true,
			typeOptions: {
				loadOptionsDependsOn: ['template.value'],
				resourceMapper: {
					resourceMapperMethod: 'getTemplateFields',
					mode: 'add',
					fieldWords: { singular: 'field', plural: 'fields' },
					addAllFields: true,
					multiKeyMatch: false,
					supportAutoMap: false,
				},
			},
			displayOptions: { show: { resource: [resource], operation: [operation], dataMode: ['mapEachField'] } },
		},
		{
			displayName: 'Data (JSON)',
			name: 'dataJson',
			type: 'json',
			default: '{}',
			description: 'The template data as one JSON object',
			displayOptions: { show: { resource: [resource], operation: [operation], dataMode: ['json'] } },
		},
	];
}

/** The template's `data` object for item `itemIndex`. */
export function templateData(this: IExecuteFunctions, itemIndex: number): IDataObject {
	if (this.getNodeParameter('dataMode', itemIndex) === 'json') {
		const raw = this.getNodeParameter('dataJson', itemIndex, '{}') as string | IDataObject;
		const data = typeof raw === 'string' ? jsonParse<unknown>(raw || '{}', { errorMessage: 'Data (JSON) is not valid JSON' }) : raw;
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			throw new NodeOperationError(this.getNode(), 'Data (JSON) must be a JSON object.', { itemIndex });
		}
		return data as IDataObject;
	}
	const mapped = this.getNodeParameter('templateData', itemIndex) as ResourceMapperValue;
	return dataFromMappedValues(mapped.value as IDataObject | null, mapped.schema);
}

/** "Download File", "Put Output File in Field" and "Simplify". */
export function outputFields(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Download File',
			name: 'download',
			type: 'boolean',
			default: true,
			description: 'Whether to add the rendered file as binary data, e.g. to attach it to an email or upload it',
			displayOptions,
		},
		{
			displayName: 'Put Output File in Field',
			name: 'binaryPropertyName',
			type: 'string',
			default: 'data',
			hint: 'The name of the output binary field. Further files go to data_2, data_3 and so on.',
			displayOptions: { show: { ...displayOptions.show, download: [true] } },
		},
		{
			displayName: 'Simplify',
			name: 'simplify',
			type: 'boolean',
			default: true,
			description: 'Whether to return a simplified version of the response instead of the raw data',
			displayOptions,
		},
	];
}

/** "Options" of an operation that renders: file name, reference, metadata and waiting. */
export function renderOptions(displayOptions: IDisplayOptions, extra: INodeProperties[] = []): INodeProperties {
	return {
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions,
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'invoice-1042.pdf',
				description: "The output file's name. Leave empty for the template's or API's default.",
			},
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWaitSeconds',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 3600 },
				default: DEFAULT_MAX_WAIT_SECONDS,
				description: 'How long to wait for a render that takes longer than 25 seconds',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add metadata',
				description: 'Your own key/value pairs, stored with the render (at most 50)',
				options: [
					{
						displayName: 'Values',
						name: 'values',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Reference',
				name: 'reference',
				type: 'string',
				default: '',
				placeholder: 'order-1042',
				description: 'Your own reference, such as an order number. Render → Get Many can filter by it.',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description:
					'Whether to wait for renders that take longer than 25 seconds. Off returns them with the status queued or processing.',
			},
			...extra,
		],
	};
}

export function pdfOptionsField(displayOptions: IDisplayOptions, forWebPages = false): INodeProperties {
	const options: INodeProperties[] = [
		{
			displayName: 'Footer (HTML)',
			name: 'footerHtml',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'HTML repeated at the bottom of every page. &lt;span class="pageNumber"&gt;&lt;/span&gt; and &lt;span class="totalPages"&gt;&lt;/span&gt; insert page numbers.',
		},
		{
			displayName: 'Header (HTML)',
			name: 'headerHtml',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'HTML repeated at the top of every page',
		},
		{
			displayName: 'Margins',
			name: 'margin',
			type: 'string',
			default: '',
			placeholder: '20mm',
			description: 'All four margins as a CSS length, e.g. 20mm or 0.5in',
		},
		{
			displayName: 'Orientation',
			name: 'orientation',
			type: 'options',
			default: 'portrait',
			options: [
				{ name: 'Portrait', value: 'portrait' },
				{ name: 'Landscape', value: 'landscape' },
			],
		},
		{
			displayName: 'Outline',
			name: 'outline',
			type: 'boolean',
			default: false,
			description: 'Whether to add PDF bookmarks from the headings',
		},
		{
			displayName: 'Page Ranges',
			name: 'pageRanges',
			type: 'string',
			default: '',
			placeholder: '1-3,5',
			description: 'Only these pages',
		},
		{
			displayName: 'Paper Size',
			name: 'paperSize',
			type: 'options',
			default: 'A4',
			options: PAPER_SIZES.map((size) => ({ name: size, value: size })),
		},
		{
			displayName: 'PDF/A',
			name: 'pdfA',
			type: 'options',
			default: '',
			options: [
				{ name: 'Off', value: '' },
				{ name: 'PDF/A-2b', value: '2b' },
				{ name: 'PDF/A-3b', value: '3b' },
			],
			description: 'An archivable PDF/A document (Growth plan or higher)',
		},
		{
			displayName: 'PDF/UA',
			name: 'pdfUa',
			type: 'boolean',
			default: false,
			description: 'Whether to make an accessible PDF/UA-1 document (Growth plan or higher)',
		},
		{
			displayName: 'Print Background',
			name: 'printBackground',
			type: 'boolean',
			default: true,
			description: 'Whether to print background colours and images',
		},
		{
			displayName: 'Scale',
			name: 'scale',
			type: 'number',
			typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
			default: 1,
		},
		{
			displayName: 'Tagged',
			name: 'tagged',
			type: 'boolean',
			default: false,
			description: 'Whether to add the accessibility structure (a tagged PDF)',
		},
	];
	if (forWebPages) {
		options.unshift({
			displayName: 'CSS Media Type',
			name: 'emulateMedia',
			type: 'options',
			default: 'print',
			options: [
				{ name: 'Print', value: 'print' },
				{ name: 'Screen', value: 'screen' },
			],
			description: "Print the page with its print styles, or as it looks on screen",
		});
	}
	return {
		displayName: 'PDF Options',
		name: 'pdfOptions',
		type: 'collection',
		placeholder: 'Add PDF option',
		default: {},
		displayOptions,
		description: `See ${DOCS_URL}/pdf-options`,
		options,
	};
}

export function imageOptionsField(displayOptions: IDisplayOptions, forWebPages = false): INodeProperties {
	const options: INodeProperties[] = [
		{
			displayName: 'Format',
			name: 'format',
			type: 'options',
			default: 'png',
			options: [
				{ name: 'PNG', value: 'png' },
				{ name: 'JPEG', value: 'jpeg' },
				{ name: 'WebP', value: 'webp' },
			],
		},
		{
			displayName: 'Height',
			name: 'height',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10000 },
			default: 630,
			description: 'In pixels',
		},
		{
			displayName: 'Quality',
			name: 'quality',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 100 },
			default: 90,
			description: 'JPEG and WebP quality',
		},
		{
			displayName: 'Scale',
			name: 'scale',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 3, numberPrecision: 1 },
			default: 1,
			description: 'Device scale factor, 2 for retina images',
		},
		{
			displayName: 'Transparent Background',
			name: 'transparent',
			type: 'boolean',
			default: false,
			description: 'Whether to keep the background transparent (PNG and WebP)',
		},
		{
			displayName: 'Width',
			name: 'width',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10000 },
			default: 1200,
			description: 'In pixels',
		},
	];
	if (forWebPages) {
		options.splice(1, 0, {
			displayName: 'Full Page',
			name: 'fullPage',
			type: 'boolean',
			default: false,
			description: 'Whether to capture the whole scrollable page',
		});
	}
	return {
		displayName: 'Image Options',
		name: 'imageOptions',
		type: 'collection',
		placeholder: 'Add image option',
		default: {},
		displayOptions,
		options,
	};
}

/** "Wait Until" for pages loaded from a URL. */
export function pageWaitFields(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Wait Until',
			name: 'waitUntil',
			type: 'options',
			default: 'load',
			options: [
				{ name: 'The Page Has Loaded', value: 'load' },
				{ name: 'The Network Is Idle', value: 'networkidle', description: 'For pages that load data' },
				{ name: 'An Element Appears', value: 'selector' },
				{ name: 'A Fixed Delay', value: 'delay' },
			],
			displayOptions,
		},
		{
			displayName: 'CSS Selector',
			name: 'waitSelector',
			type: 'string',
			default: '',
			placeholder: '#report-ready',
			displayOptions: { show: { ...displayOptions.show, waitUntil: ['selector'] } },
		},
		{
			displayName: 'Delay (Ms)',
			name: 'waitDelayMs',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 10000 },
			default: 1000,
			displayOptions: { show: { ...displayOptions.show, waitUntil: ['delay'] } },
		},
	];
}

/** The `wait` object for a URL render, or `undefined` for the default (page loaded). */
export function pageWait(this: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const until = this.getNodeParameter('waitUntil', itemIndex, 'load') as string;
	if (until === 'load') return undefined;
	const wait: IDataObject = { until };
	if (until === 'selector') wait.selector = this.getNodeParameter('waitSelector', itemIndex, '') as string;
	if (until === 'delay') wait.delay_ms = this.getNodeParameter('waitDelayMs', itemIndex, 1000) as number;
	return wait;
}

/** A PDF input of a PDF tool: binary data from an earlier node, a URL, or an earlier render. */
export function pdfSourceFields(prefix: string, displayOptions: IDisplayOptions, label = 'Input PDF'): INodeProperties[] {
	return [
		{
			displayName: `${label} From`,
			name: `${prefix}Type`,
			type: 'options',
			default: 'binary',
			options: [
				{ name: 'Binary Field', value: 'binary', description: 'A PDF from an earlier node' },
				{ name: 'URL', value: 'url', description: 'A public https URL of a PDF' },
				{ name: 'Render', value: 'render', description: 'An earlier render of this workspace' },
			],
			displayOptions,
		},
		{
			displayName: 'Input Binary Field',
			name: `${prefix}BinaryProperty`,
			type: 'string',
			default: 'data',
			hint: 'The name of the input binary field containing the PDF',
			displayOptions: { show: { ...displayOptions.show, [`${prefix}Type`]: ['binary'] } },
		},
		{
			displayName: 'PDF URL',
			name: `${prefix}Url`,
			type: 'string',
			default: '',
			placeholder: 'https://example.com/document.pdf',
			displayOptions: { show: { ...displayOptions.show, [`${prefix}Type`]: ['url'] } },
		},
		{
			displayName: 'Render ID',
			name: `${prefix}RenderId`,
			type: 'string',
			default: '',
			placeholder: 'rnd_01J9ZM…',
			displayOptions: { show: { ...displayOptions.show, [`${prefix}Type`]: ['render'] } },
		},
	];
}

/** The `source` object for a PDF tool; binary data is uploaded first. */
export async function pdfSource(this: IExecuteFunctions, prefix: string, itemIndex: number): Promise<IDataObject> {
	const type = this.getNodeParameter(`${prefix}Type`, itemIndex) as string;
	if (type === 'url') return { url: (this.getNodeParameter(`${prefix}Url`, itemIndex) as string).trim() };
	if (type === 'render') return { render_id: (this.getNodeParameter(`${prefix}RenderId`, itemIndex) as string).trim() };
	const property = this.getNodeParameter(`${prefix}BinaryProperty`, itemIndex) as string;
	return { upload_id: await uploadBinary.call(this, property, itemIndex) };
}

/** Uploads an item's binary field and returns the upload id. */
export async function uploadBinary(this: IExecuteFunctions, property: string, itemIndex: number): Promise<string> {
	const binary = this.helpers.assertBinaryData(itemIndex, property);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, property);
	return uploadFile.call(this, buffer, binary.fileName ?? 'document.pdf', binary.mimeType, itemIndex);
}
