/** Account: the workspace's plan and renders left, and usage over time (GET /v1/account, /v1/usage). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { apiRequest } from '../../shared/transport';
import { show } from './common';

const R = 'account';

export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'get',
		options: [
			{
				name: 'Get',
				value: 'get',
				description: "Get the workspace's plan, billing period and renders left",
				action: 'Get the account',
			},
			{ name: 'Get Usage', value: 'getUsage', description: 'Get renders per day or hour', action: 'Get usage' },
		],
	},
	{
		displayName: 'From',
		name: 'from',
		type: 'dateTime',
		default: '',
		description: 'First day (included). Default: the start of the billing period.',
		displayOptions: show(R, ['getUsage']),
	},
	{
		displayName: 'To',
		name: 'to',
		type: 'dateTime',
		default: '',
		description: 'Last day (included). Default: today.',
		displayOptions: show(R, ['getUsage']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: show(R, ['getUsage']),
		options: [
			{
				displayName: 'Granularity',
				name: 'granularity',
				type: 'options',
				default: 'day',
				options: [
					{ name: 'Day', value: 'day' },
					{ name: 'Hour', value: 'hour' },
				],
			},
			{
				displayName: 'Group By',
				name: 'group_by',
				type: 'options',
				default: 'source',
				options: [
					{ name: 'API Key', value: 'key_id' },
					{ name: 'Kind', value: 'kind' },
					{ name: 'Region', value: 'region' },
					{ name: 'Source', value: 'source' },
					{ name: 'Template', value: 'template_id' },
				],
			},
		],
	},
];

/** `YYYY-MM-DD` of a date parameter, or `undefined` when it's empty. */
function day(value: unknown): string | undefined {
	if (!value) return undefined;
	const ms = Date.parse(String(value));
	return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

export async function executeAccount(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'get') {
		const account = (await apiRequest.call(this, 'GET', '/account', { itemIndex })) as IDataObject;
		return [{ json: account, pairedItem: { item: itemIndex } }];
	}
	if (operation === 'getUsage') {
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const usage = (await apiRequest.call(this, 'GET', '/usage', {
			qs: {
				from: day(this.getNodeParameter('from', itemIndex, '')),
				to: day(this.getNodeParameter('to', itemIndex, '')),
				granularity: options.granularity,
				group_by: options.group_by,
			},
			itemIndex,
		})) as IDataObject;
		return [{ json: usage, pairedItem: { item: itemIndex } }];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
