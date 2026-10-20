/** Signed Link: a signed URL that renders a personalised image or PDF when opened (POST /v1/signed-links/{id}/sign). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { keyValues } from '../../shared/render';
import { apiRequest } from '../../shared/transport';
import { show } from './common';

const R = 'signedLink';

export const signedLinkDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'sign',
		options: [
			{
				name: 'Sign URL',
				value: 'sign',
				description: 'Create a signed URL that renders the link\'s template with your parameters when opened',
				action: 'Sign a URL',
			},
		],
	},
	{
		displayName: 'Signed Link',
		name: 'link',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Set up signed links in the dashboard under Signed URLs',
		displayOptions: show(R, ['sign']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchSignedLinks', searchable: true },
			},
			{ displayName: 'ID', name: 'id', type: 'string', placeholder: 'lnk_01J9ZK…' },
		],
	},
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		default: 'png',
		options: [
			{ name: 'JPEG', value: 'jpeg' },
			{ name: 'PDF', value: 'pdf' },
			{ name: 'PNG', value: 'png' },
			{ name: 'WebP', value: 'webp' },
		],
		description: 'One of the formats the link allows',
		displayOptions: show(R, ['sign']),
	},
	{
		displayName: 'Parameters',
		name: 'params',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add parameter',
		description: 'Values for the parameters the link lets callers set, e.g. title.text',
		displayOptions: show(R, ['sign']),
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{ displayName: 'Key', name: 'key', type: 'string', default: '', placeholder: 'title.text' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: show(R, ['sign']),
		options: [
			{
				displayName: 'File Name',
				name: 'name',
				type: 'string',
				default: 'render',
				description: 'The name in the URL, without extension',
			},
			{
				displayName: 'Valid Until',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				description: 'Leave empty for a URL that stays valid as long as the link does',
			},
		],
	},
];

export async function executeSignedLink(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'sign') {
		throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
	}
	const linkId = this.getNodeParameter('link', itemIndex, '', { extractValue: true }) as string;
	const format = this.getNodeParameter('format', itemIndex, 'png') as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const body: IDataObject = { format, params: keyValues(this.getNodeParameter('params', itemIndex, {})) ?? {} };
	if (typeof options.name === 'string' && options.name.trim()) body.name = options.name.trim();
	if (options.expiresAt) {
		const ms = Date.parse(String(options.expiresAt));
		if (!Number.isFinite(ms)) throw new NodeOperationError(this.getNode(), 'Valid Until is not a date.', { itemIndex });
		body.expires_at = Math.floor(ms / 1000);
	}
	const signed = (await apiRequest.call(this, 'POST', `/signed-links/${encodeURIComponent(linkId)}/sign`, {
		body,
		itemIndex,
	})) as IDataObject;
	return [
		{
			json: {
				...signed,
				link_id: linkId,
				format,
				expires_at: typeof body.expires_at === 'number' ? new Date(body.expires_at * 1000).toISOString() : null,
			},
			pairedItem: { item: itemIndex },
		},
	];
}
