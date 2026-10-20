/** Batch: many documents from one template (POST /v1/batches), its status and its items. */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { DEFAULT_MAX_WAIT_SECONDS } from '../../shared/constants';
import { envelope, filesAsBinary, idempotencyKey, isBatchDone, waitForBatch } from '../../shared/render';
import { apiRequest } from '../../shared/transport';
import type { Batch, Page } from '../../shared/types';
import { show, templateLocator } from './common';

const R = 'batch';

export const batchDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'create',
		options: [
			{ name: 'Create', value: 'create', description: 'Render one document per item from a template', action: 'Create a batch' },
			{ name: 'Get', value: 'get', description: "Get a batch's status and files", action: 'Get a batch' },
			{ name: 'Get Items', value: 'getItems', description: 'Get the renders of a batch', action: 'Get the items of a batch' },
		],
	},
	templateLocator(show(R, ['create']), 'The published template every item renders'),
	{
		displayName: 'Items (JSON)',
		name: 'items',
		type: 'json',
		default: '[]',
		required: true,
		description:
			'A JSON array with one entry per document: the template data, or {"data": …, "filename": …, "reference": …}',
		displayOptions: show(R, ['create']),
	},
	{
		displayName: 'Combine Files',
		name: 'combine',
		type: 'options',
		default: 'none',
		options: [
			{ name: 'No, One File per Item', value: 'none' },
			{ name: 'One ZIP With Every File', value: 'zip' },
			{ name: 'One Merged PDF', value: 'merged_pdf' },
		],
		displayOptions: show(R, ['create']),
	},
	{
		displayName: 'ZIP File Name',
		name: 'zipFilename',
		type: 'string',
		default: '',
		placeholder: 'certificates.zip',
		displayOptions: { show: { resource: [R], operation: ['create'], combine: ['zip'] } },
	},
	{
		displayName: 'Batch ID',
		name: 'batchId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'bat_01J9ZM…',
		displayOptions: show(R, ['get', 'getItems']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(R, ['getItems']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [R], operation: ['getItems'], returnAll: [false] } },
	},
	{
		displayName: 'Download ZIP or Merged PDF',
		name: 'download',
		type: 'boolean',
		default: false,
		description: "Whether to add the batch's ZIP or merged PDF as binary data once the batch is done",
		displayOptions: show(R, ['create', 'get']),
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: { show: { resource: [R], operation: ['create', 'get'], download: [true] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: show(R, ['create']),
		options: [
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWaitSeconds',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 3600 },
				default: DEFAULT_MAX_WAIT_SECONDS,
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add metadata',
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
			{ displayName: 'Reference', name: 'reference', type: 'string', default: '' },
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: false,
				description: 'Whether to wait until every item has rendered. Off returns the batch while it runs.',
			},
		],
	},
];

function asItems(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const raw = this.getNodeParameter('items', itemIndex) as string | IDataObject[];
	const items = typeof raw === 'string' ? jsonParse<unknown>(raw, { errorMessage: 'Items (JSON) is not valid JSON' }) : raw;
	if (!Array.isArray(items) || !items.length) {
		throw new NodeOperationError(this.getNode(), 'Items (JSON) must be a JSON array with at least one item.', { itemIndex });
	}
	// An entry without `data` is the template data itself.
	return items.map((item) =>
		item && typeof item === 'object' && 'data' in (item as IDataObject) ? (item as IDataObject) : { data: item as IDataObject },
	);
}

async function batchResult(this: IExecuteFunctions, batch: Batch, itemIndex: number): Promise<INodeExecutionData> {
	const item: INodeExecutionData = { json: batch as unknown as IDataObject, pairedItem: { item: itemIndex } };
	if (this.getNodeParameter('download', itemIndex, false) && isBatchDone(batch)) {
		const property = (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string) || 'data';
		const binary = await filesAsBinary.call(this, batch.files ?? [], property);
		if (binary) item.binary = binary;
	}
	return item;
}

export async function executeBatch(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'create') {
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const combine = this.getNodeParameter('combine', itemIndex, 'none') as string;
		const zipFilename = (this.getNodeParameter('zipFilename', itemIndex, '') as string).trim();
		const body: IDataObject = {
			...envelope(options, false),
			template_id: this.getNodeParameter('template', itemIndex, '', { extractValue: true }) as string,
			items: asItems.call(this, itemIndex),
		};
		if (combine === 'zip') body.combine = { zip: true, ...(zipFilename ? { zip_filename: zipFilename } : {}) };
		if (combine === 'merged_pdf') body.combine = { merged_pdf: true };
		let batch = (await apiRequest.call(this, 'POST', '/batches', {
			body,
			idempotencyKey: idempotencyKey(this, itemIndex),
			itemIndex,
		})) as Batch;
		if (options.waitForCompletion === true) {
			const maxWait = typeof options.maxWaitSeconds === 'number' ? options.maxWaitSeconds : DEFAULT_MAX_WAIT_SECONDS;
			batch = await waitForBatch.call(this, batch, maxWait, itemIndex);
		}
		return [await batchResult.call(this, batch, itemIndex)];
	}

	const batchId = encodeURIComponent((this.getNodeParameter('batchId', itemIndex) as string).trim());
	if (operation === 'get') {
		const batch = (await apiRequest.call(this, 'GET', `/batches/${batchId}`, { itemIndex })) as Batch;
		return [await batchResult.call(this, batch, itemIndex)];
	}
	if (operation === 'getItems') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex, 50) as number);
		const results: IDataObject[] = [];
		let cursor: string | undefined;
		do {
			const page = (await apiRequest.call(this, 'GET', `/batches/${batchId}/items`, {
				qs: { cursor, limit: Math.min(100, limit - results.length) },
				itemIndex,
			})) as Page<IDataObject>;
			results.push(...page.data);
			cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
		} while (cursor && results.length < limit);
		return results.slice(0, limit).map((json) => ({ json, pairedItem: { item: itemIndex } }));
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
