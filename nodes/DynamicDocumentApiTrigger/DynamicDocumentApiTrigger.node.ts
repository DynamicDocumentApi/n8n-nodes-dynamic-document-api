/**
 * Starts a workflow on Dynamic Document API webhook events. Activating the workflow creates a webhook endpoint for
 * the node's URL (never the workspace's default endpoint); deactivating it deletes the endpoint. Every delivery's
 * Standard Webhooks signature is checked against the endpoint secret kept in the node's static data.
 */
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { CREDENTIALS_NAME, SOURCE } from '../shared/constants';
import { getTemplateOptions } from '../shared/methods';
import { apiRequest } from '../shared/transport';
import type { Render, WebhookEndpoint, WebhookEvent } from '../shared/types';
import { verifySignature } from '../shared/webhooks';

const EVENTS = [
	{ name: 'API Key Expiring', value: 'api_key.expiring', description: 'An API key expires in seven days' },
	{ name: 'Batch Completed', value: 'batch.completed', description: 'A batch finished' },
	{ name: 'Batch Progress', value: 'batch.progress', description: 'A batch made progress' },
	{ name: 'Email Bounced', value: 'email.bounced' },
	{ name: 'Email Complained', value: 'email.complained' },
	{ name: 'Email Delivered', value: 'email.delivered' },
	{ name: 'Email Send Failed', value: 'email.send_failed' },
	{ name: 'Email Sent', value: 'email.sent' },
	{ name: 'Render Expired', value: 'render.expired', description: "A render's files were deleted" },
	{ name: 'Render Failed', value: 'render.failed', description: 'A render failed, with the error code and message' },
	{ name: 'Render Succeeded', value: 'render.succeeded', description: 'A document or image finished rendering' },
	{ name: 'Storage Upload Failed', value: 'storage.upload_failed' },
	{ name: 'Template Published', value: 'template.published', description: 'A template got a new live version' },
	{ name: 'Usage Threshold Reached', value: 'usage.threshold_reached' },
];

/** Objects of sample events (POST /v1/webhook-endpoints/{id}/test) carry this reference. */
const SAMPLE_REFERENCE = 'test_event';

type StaticData = IDataObject & { webhookId?: string; webhookSecret?: string };

function sameMembers(a: unknown, b: unknown): boolean {
	const left = Array.isArray(a) ? [...a].map(String).sort() : [];
	const right = Array.isArray(b) ? [...b].map(String).sort() : [];
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class DynamicDocumentApiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Dynamic Document API Trigger',
		name: 'dynamicDocumentApiTrigger',
		icon: { light: 'file:dynamicDocumentApi.svg', dark: 'file:dynamicDocumentApi.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a render, batch, template or account event happens',
		defaults: { name: 'Dynamic Document API Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIALS_NAME, required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['render.succeeded'],
				options: EVENTS,
			},
			{
				displayName: 'Template Names or IDs',
				name: 'templateIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTemplateOptions' },
				default: [],
				description:
					'Only events of renders and batches of these templates. Renders without a template (HTML, URL, PDF tools) then never match. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Fetch Fresh Render',
						name: 'fetchRender',
						type: 'boolean',
						default: true,
						description:
							'Whether to load render events\' renders again, for file links that work (event copies have none)',
					},
					{
						displayName: 'Renders Made in N8n',
						name: 'n8nRenders',
						type: 'options',
						default: 'skip',
						options: [
							{
								name: 'Skip Them',
								value: 'skip',
								description: "A workflow that renders in its own steps can't start itself again",
							},
							{ name: 'Include Them', value: 'include', description: 'Filter by template to avoid loops' },
						],
					},
					{
						displayName: 'Send Sample Event When Listening',
						name: 'sendSample',
						type: 'boolean',
						default: true,
						description:
							'Whether "Listen for test event" asks Dynamic Document API to send a sample of the first event right away',
					},
					{
						displayName: 'Test Renders',
						name: 'testRenders',
						type: 'options',
						default: 'include',
						options: [
							{ name: 'Include Them', value: 'include' },
							{ name: 'Skip Them', value: 'exclude' },
							{ name: 'Only Them', value: 'only' },
						],
						description: 'Whether renders made with a test key start the workflow',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: { getTemplateOptions },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				if (!data.webhookId) return false;
				const endpoint = (await apiRequest.call(
					this,
					'GET',
					`/webhook-endpoints/${encodeURIComponent(data.webhookId)}`,
					{ allowNotFound: true },
				)) as WebhookEndpoint | null;
				const current =
					endpoint &&
					endpoint.url === this.getNodeWebhookUrl('default') &&
					sameMembers(endpoint.events, this.getNodeParameter('events')) &&
					sameMembers(endpoint.template_ids ?? [], this.getNodeParameter('templateIds', []));
				if (current && data.webhookSecret) return true;
				// Gone, or set up for other events or templates: start over with a new endpoint.
				if (endpoint) {
					await apiRequest.call(this, 'DELETE', `/webhook-endpoints/${encodeURIComponent(endpoint.id)}`, {
						allowNotFound: true,
					});
				}
				delete data.webhookId;
				delete data.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				const events = this.getNodeParameter('events') as string[];
				const templateIds = this.getNodeParameter('templateIds', []) as string[];
				const workflow = this.getWorkflow();
				const endpoint = (await apiRequest.call(this, 'POST', '/webhook-endpoints', {
					body: {
						url: this.getNodeWebhookUrl('default') as string,
						events,
						description: `n8n: ${workflow.name ?? workflow.id ?? 'workflow'}`.slice(0, 255),
						...(templateIds.length ? { template_ids: templateIds } : {}),
						// An integration's endpoint must not sign the workspace's per-request webhooks.
						is_default: false,
					},
				})) as WebhookEndpoint;
				data.webhookId = endpoint.id;
				data.webhookSecret = endpoint.secret;

				const options = this.getNodeParameter('options', {}) as IDataObject;
				if (this.getMode() === 'manual' && options.sendSample !== false && events.length) {
					await apiRequest.call(this, 'POST', `/webhook-endpoints/${encodeURIComponent(endpoint.id)}/test`, {
						body: { event: events[0] },
					});
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as StaticData;
				if (data.webhookId) {
					await apiRequest.call(this, 'DELETE', `/webhook-endpoints/${encodeURIComponent(data.webhookId)}`, {
						allowNotFound: true,
					});
				}
				delete data.webhookId;
				delete data.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject() as unknown as { rawBody?: Buffer };
		const data = this.getWorkflowStaticData('node') as StaticData;
		const check =
			data.webhookSecret && request.rawBody
				? verifySignature(request.rawBody, this.getHeaderData() as Record<string, string>, data.webhookSecret, Math.floor(Date.now() / 1000))
				: { valid: false as const, reason: 'no endpoint secret' };
		if (!check.valid) {
			const response = this.getResponseObject();
			response.status(401).json({ error: `Invalid webhook signature (${check.reason}).` });
			return { noWebhookResponse: true };
		}

		const event = this.getBodyData() as unknown as WebhookEvent;
		const object = event.data?.object;
		const isSample = object?.reference === SAMPLE_REFERENCE;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		if (event.type?.startsWith('render.') && object && !isSample) {
			const render = object as unknown as Render;
			if ((options.n8nRenders ?? 'skip') === 'skip' && render.source === SOURCE) return {};
			if (options.testRenders === 'exclude' && render.test) return {};
			if (options.testRenders === 'only' && !render.test) return {};
			if (options.fetchRender !== false) {
				const fresh = (await apiRequest.call(this, 'GET', `/renders/${encodeURIComponent(render.id)}`, {
					allowNotFound: true,
				})) as Render | null;
				if (fresh) event.data = { ...event.data, object: fresh as unknown as IDataObject };
			}
		}

		return { workflowData: [this.helpers.returnJsonArray([event as unknown as IDataObject])] };
	}
}
