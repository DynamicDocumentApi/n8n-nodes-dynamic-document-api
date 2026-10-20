/** Template: get templates and the data a template expects (GET /v1/templates…). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { apiRequest } from '../../shared/transport';
import type { Page } from '../../shared/types';
import { show, templateLocator } from './common';

const R = 'template';

export const templateDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getAll',
		options: [
			{ name: 'Get', value: 'get', description: 'Get a template', action: 'Get a template' },
			{ name: 'Get Many', value: 'getAll', description: 'List templates, sorted by name', action: 'Get many templates' },
			{
				name: 'Get Schema',
				value: 'getSchema',
				description: 'Get the JSON Schema of the data a template expects',
				action: 'Get the data schema of a template',
			},
		],
	},
	templateLocator(show(R, ['get', 'getSchema']), 'The template'),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(R, ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [R], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: show(R, ['getAll']),
		options: [
			{ displayName: 'Name Contains', name: 'q', type: 'string', default: '' },
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'pdf_code',
				options: [
					{ name: 'Image', value: 'image_canvas' },
					{ name: 'Markdown PDF', value: 'pdf_markdown' },
					{ name: 'PDF', value: 'pdf_code' },
					{ name: 'PDF Form', value: 'pdf_form' },
					{ name: 'Word', value: 'docx' },
				],
			},
			{
				displayName: 'Published Only',
				name: 'publishedOnly',
				type: 'boolean',
				default: true,
				description: 'Whether to leave out templates without a live version',
			},
		],
	},
];

export async function executeTemplate(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex, 50) as number);
		const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
		const templates: IDataObject[] = [];
		let cursor: string | undefined;
		do {
			const page = (await apiRequest.call(this, 'GET', '/templates', {
				qs: { q: filters.q, type: filters.type, cursor, limit: 100 },
				itemIndex,
			})) as Page<IDataObject>;
			templates.push(...page.data.filter((template) => filters.publishedOnly === false || !!template.live_version));
			cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
		} while (cursor && templates.length < limit);
		return templates.slice(0, limit).map((json) => ({ json, pairedItem: { item: itemIndex } }));
	}
	const templateId = encodeURIComponent(this.getNodeParameter('template', itemIndex, '', { extractValue: true }) as string);
	if (operation === 'get') {
		const template = (await apiRequest.call(this, 'GET', `/templates/${templateId}`, { itemIndex })) as IDataObject;
		return [{ json: template, pairedItem: { item: itemIndex } }];
	}
	if (operation === 'getSchema') {
		const schema = (await apiRequest.call(this, 'GET', `/templates/${templateId}/schema`, { itemIndex })) as IDataObject;
		return [{ json: schema, pairedItem: { item: itemIndex } }];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
