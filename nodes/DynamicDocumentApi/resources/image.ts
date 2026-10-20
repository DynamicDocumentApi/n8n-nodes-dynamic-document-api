/** Image: PNG, JPEG or WebP from an image template, HTML or a web page (POST /v1/images/from-*). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { createRender, envelope, imageOptions } from '../../shared/render';
import {
	imageOptionsField,
	outputFields,
	pageWait,
	pageWaitFields,
	renderOptions,
	show,
	templateDataFields,
	templateData,
	templateLocator,
} from './common';

const R = 'image';

export const imageDescription: INodeProperties[] = [
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
				description: 'Create an image of HTML and CSS',
				action: 'Create an image from HTML',
			},
			{
				name: 'Create From Template',
				value: 'createFromTemplate',
				description: 'Create an image from one of your image templates, e.g. a social card',
				action: 'Create an image from a template',
			},
			{
				name: 'Create From URL',
				value: 'createFromUrl',
				description: 'Take a screenshot of a public web page',
				action: 'Create an image from a URL',
			},
		],
	},

	templateLocator(show(R, ['createFromTemplate']), 'The published image template to fill'),
	...templateDataFields(R, 'createFromTemplate'),
	{
		displayName: 'HTML',
		name: 'html',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		displayOptions: show(R, ['createFromHtml']),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com',
		description: 'A public https page',
		displayOptions: show(R, ['createFromUrl']),
	},
	...pageWaitFields(show(R, ['createFromUrl'])),

	...outputFields(show(R, ['createFromTemplate', 'createFromHtml', 'createFromUrl'])),
	imageOptionsField(show(R, ['createFromTemplate', 'createFromHtml'])),
	imageOptionsField(show(R, ['createFromUrl']), true),
	renderOptions(show(R, ['createFromTemplate', 'createFromHtml', 'createFromUrl'])),
];

export async function executeImage(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const { format, image } = imageOptions(this.getNodeParameter('imageOptions', itemIndex, {}) as IDataObject);
	const body: IDataObject = { ...envelope(options), format, image };

	if (operation === 'createFromTemplate') {
		body.template_id = this.getNodeParameter('template', itemIndex, '', { extractValue: true }) as string;
		body.data = templateData.call(this, itemIndex);
		return [await createRender.call(this, '/images/from-template', body, itemIndex)];
	}
	if (operation === 'createFromHtml') {
		body.html = this.getNodeParameter('html', itemIndex) as string;
		return [await createRender.call(this, '/images/from-html', body, itemIndex)];
	}
	if (operation === 'createFromUrl') {
		body.url = (this.getNodeParameter('url', itemIndex) as string).trim();
		const wait = pageWait.call(this, itemIndex);
		if (wait) body.image = { ...(body.image as IDataObject | undefined), wait };
		return [await createRender.call(this, '/images/from-url', body, itemIndex)];
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
}
