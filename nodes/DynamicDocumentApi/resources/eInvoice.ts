/** E-Invoice: a validated e-invoice XML (XRechnung, EN 16931, Factur-X / ZUGFeRD) from invoice data (POST /v1/einvoices). */
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { createRender, envelope } from '../../shared/render';
import { outputFields, renderOptions, show } from './common';

const R = 'eInvoice';

export const eInvoiceDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'create',
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a validated e-invoice XML from invoice data',
				action: 'Create an XML invoice',
			},
		],
	},
	{
		displayName: 'Profile',
		name: 'profile',
		type: 'options',
		default: 'XRECHNUNG',
		options: [
			{ name: 'EN 16931', value: 'EN16931' },
			{ name: 'Factur-X / ZUGFeRD BASIC', value: 'BASIC' },
			{ name: 'Factur-X / ZUGFeRD BASIC WL', value: 'BASIC_WL' },
			{ name: 'Factur-X / ZUGFeRD EXTENDED', value: 'EXTENDED' },
			{ name: 'Factur-X / ZUGFeRD MINIMUM', value: 'MINIMUM' },
			{ name: 'XRechnung 3.0 (German Public Sector)', value: 'XRECHNUNG' },
		],
		displayOptions: show(R, ['create']),
	},
	{
		displayName: 'Syntax',
		name: 'syntax',
		type: 'options',
		default: 'cii',
		options: [
			{ name: 'UN/CEFACT CII', value: 'cii', description: 'Every profile' },
			{ name: 'UBL 2.1', value: 'ubl', description: 'EN 16931 and XRechnung only' },
		],
		displayOptions: show(R, ['create']),
	},
	{
		displayName: 'Invoice (JSON)',
		name: 'invoice',
		type: 'json',
		default: '{}',
		required: true,
		description: 'The invoice as EN 16931 fields: number, issue_date, currency, seller, buyer, lines … See https://dynamicdocumentapi.com/docs/e-invoicing',
		displayOptions: show(R, ['create']),
	},
	...outputFields(show(R, ['create'])),
	renderOptions(show(R, ['create'])),
];

export async function executeEInvoice(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'create') {
		throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex });
	}
	const raw = this.getNodeParameter('invoice', itemIndex) as string | IDataObject;
	const invoice = typeof raw === 'string' ? jsonParse<IDataObject>(raw, { errorMessage: 'Invoice (JSON) is not valid JSON' }) : raw;
	const body: IDataObject = {
		...envelope(this.getNodeParameter('options', itemIndex, {}) as IDataObject),
		profile: this.getNodeParameter('profile', itemIndex) as string,
		syntax: this.getNodeParameter('syntax', itemIndex, 'cii') as string,
		invoice,
	};
	return [await createRender.call(this, '/einvoices', body, itemIndex)];
}
