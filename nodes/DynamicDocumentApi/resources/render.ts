/** Render: get, list, wait for and delete the files of renders (GET/DELETE /v1/renders…). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { DEFAULT_MAX_WAIT_SECONDS } from '../../shared/constants';
import { finishRender, simplifyRender } from '../../shared/render';
import { apiRequest } from '../../shared/transport';
import type { Page, Render } from '../../shared/types';
import { outputFields, show } from './common';

const R = 'render';

export const renderDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'get',
		options: [
			{ name: 'Delete Files', value: 'deleteFiles', description: "Delete a render's stored files right away", action: 'Delete the files of a render' },
			{ name: 'Get', value: 'get', description: 'Get a render with fresh links to its files', action: 'Get a render' },
			{ name: 'Get Many', value: 'getAll', description: 'List renders, newest first', action: 'Get many renders' },
			{ name: 'Wait', value: 'wait', description: 'Wait until a render that is still running is done', action: 'Wait for a render' },
		],
	},
	{
		displayName: 'Render ID',
		name: 'renderId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'rnd_01J9ZM…',
		displayOptions: show(R, ['get', 'wait', 'deleteFiles']),
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWaitSeconds',
		type: 'number',
		typeOptions: { minValue: 5, maxValue: 3600 },
		default: DEFAULT_MAX_WAIT_SECONDS,
		displayOptions: show(R, ['wait']),
	},
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
			{ displayName: 'Batch ID', name: 'batch_id', type: 'string', default: '' },
			{ displayName: 'Created After', name: 'created_gte', type: 'dateTime', default: '' },
			{ displayName: 'Created Before', name: 'created_lte', type: 'dateTime', default: '' },
			{ displayName: 'Reference', name: 'reference', type: 'string', default: '' },
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				default: 'n8n',
				options: [
					{ name: 'API', value: 'api' },
					{ name: 'Dashboard', value: 'dashboard' },
					{ name: 'MCP', value: 'mcp' },
					{ name: 'N8n', value: 'n8n' },
					{ name: 'Signed Link', value: 'signed_link' },
					{ name: 'Zapier', value: 'zapier' },
				],
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'multiOptions',
				default: [],
				options: [
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Expired', value: 'expired' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Processing', value: 'processing' },
					{ name: 'Queued', value: 'queued' },
					{ name: 'Succeeded', value: 'succeeded' },
				],
			},
			{ displayName: 'Template ID', name: 'template_id', type: 'string', default: '' },
			{
				displayName: 'Test Renders',
				name: 'test',
				type: 'options',
				default: 'false',
				options: [
					{ name: 'Only Test Renders', value: 'true' },
					{ name: 'Only Final Renders', value: 'false' },
				],
			},
		],
	},
	...outputFields(show(R, ['get', 'wait'])),
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: show(R, ['getAll']),
	},
];

function listQuery(filters: IDataObject): IDataObject {
	const qs: IDataObject = {};
	for (const key of ['batch_id', 'reference', 'source', 'template_id', 'test']) {
		if (typeof filters[key] === 'string' && filters[key] !== '') qs[key] = filters[key];
	}
	if (Array.isArray(filters.status) && filters.status.length) qs.status = filters.status.join(',');
	if (filters.created_gte) qs['created[gte]'] = filters.created_gte;
	if (filters.created_lte) qs['created[lte]'] = filters.created_lte;
	return qs;
}

export async function executeRender(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex, 50) as number);
		const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
		const qs = listQuery(this.getNodeParameter('filters', itemIndex, {}) as IDataObject);
		const renders: Render[] = [];
		let cursor: string | undefined;
		do {
			const page = (await apiRequest.call(this, 'GET', '/renders', {
				qs: { ...qs, cursor, limit: Math.min(100, limit - renders.length) },
				itemIndex,
			})) as Page<Render>;
			renders.push(...page.data);
			cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
		} while (cursor && renders.length < limit);
		return renders.slice(0, limit).map((render) => ({
			json: simplify ? simplifyRender(render) : (render as unknown as IDataObject),
			pairedItem: { item: itemIndex },
		}));
	}

	const renderId = encodeURIComponent((this.getNodeParameter('renderId', itemIndex) as string).trim());
	if (operation === 'deleteFiles') {
		const render = (await apiRequest.call(this, 'DELETE', `/renders/${renderId}/files`, { itemIndex })) as Render;
		return [{ json: { deleted: true, id: render?.id ?? decodeURIComponent(renderId), status: render?.status ?? null }, pairedItem: { item: itemIndex } }];
	}
	if (operation === 'get' || operation === 'wait') {
		const render = (await apiRequest.call(this, 'GET', `/renders/${renderId}`, { itemIndex })) as Render;
		const settings = {
			download: this.getNodeParameter('download', itemIndex, true) as boolean,
			binaryPropertyName: (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string) || 'data',
			simplify: this.getNodeParameter('simplify', itemIndex, true) as boolean,
			wait: operation === 'wait',
			maxWaitSeconds: this.getNodeParameter('maxWaitSeconds', itemIndex, DEFAULT_MAX_WAIT_SECONDS) as number,
			failOnError: false,
		};
		return [await finishRender.call(this, render, itemIndex, settings)];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
