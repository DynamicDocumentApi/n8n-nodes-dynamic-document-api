/**
 * Dynamic Document API: PDFs, images and e-invoices from templates, HTML, web pages and Markdown, PDF tools, batches
 * and signed image URLs.
 *
 * Programmatic rather than declarative: an operation can need several dependent calls (upload binary input before a
 * PDF tool, wait for a render that outlived the 25 s connector budget, download the result as binary data) and the
 * template data is rebuilt from resource-mapper fields.
 */
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CREDENTIALS_NAME } from '../shared/constants';
import { getTemplateFields, searchSignedLinks, searchTemplates } from '../shared/methods';
import { accountDescription, executeAccount } from './resources/account';
import { batchDescription, executeBatch } from './resources/batch';
import { documentDescription, executeDocument } from './resources/document';
import { eInvoiceDescription, executeEInvoice } from './resources/eInvoice';
import { executeImage, imageDescription } from './resources/image';
import { executePdfTool, pdfToolDescription } from './resources/pdfTool';
import { executeRender, renderDescription } from './resources/render';
import { executeSignedLink, signedLinkDescription } from './resources/signedLink';
import { executeTemplate, templateDescription } from './resources/template';

type Execute = (this: IExecuteFunctions, operation: string, itemIndex: number) => Promise<INodeExecutionData[]>;

const EXECUTORS: Record<string, Execute> = {
	account: executeAccount,
	batch: executeBatch,
	document: executeDocument,
	eInvoice: executeEInvoice,
	image: executeImage,
	pdfTool: executePdfTool,
	render: executeRender,
	signedLink: executeSignedLink,
	template: executeTemplate,
};

export class DynamicDocumentApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Dynamic Document API',
		name: 'dynamicDocumentApi',
		icon: { light: 'file:dynamicDocumentApi.svg', dark: 'file:dynamicDocumentApi.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create PDFs, images and e-invoices from templates, HTML, web pages and Markdown',
		defaults: { name: 'Dynamic Document API' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIALS_NAME, required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'document',
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Batch', value: 'batch' },
					{ name: 'Document (PDF)', value: 'document' },
					{ name: 'E-Invoice', value: 'eInvoice' },
					{ name: 'Image', value: 'image' },
					{ name: 'PDF Tool', value: 'pdfTool' },
					{ name: 'Render', value: 'render' },
					{ name: 'Signed Link', value: 'signedLink' },
					{ name: 'Template', value: 'template' },
				],
			},
			...documentDescription,
			...imageDescription,
			...pdfToolDescription,
			...eInvoiceDescription,
			...batchDescription,
			...renderDescription,
			...templateDescription,
			...signedLinkDescription,
			...accountDescription,
		],
	};

	methods = {
		listSearch: { searchTemplates, searchSignedLinks },
		resourceMapping: { getTemplateFields },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const run = EXECUTORS[resource];
				if (!run) {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, { itemIndex });
				}
				returnData.push(...(await run.call(this, operation, itemIndex)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: itemIndex } });
					continue;
				}
				// Both constructors hand back an error that already has their type.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
