import { createHmac } from 'node:crypto';

import type { IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DynamicDocumentApiTrigger } from '../nodes/DynamicDocumentApiTrigger/DynamicDocumentApiTrigger.node';
import { type Handler, fakeContext, render } from './context';

const API = 'https://api-eu.dynamicdocumentapi.com/v1';
const SECRET = `whsec_${Buffer.from('k'.repeat(32)).toString('base64')}`;
const trigger = new DynamicDocumentApiTrigger();
const hooks = trigger.webhookMethods.default;

afterEach(() => vi.restoreAllMocks());

describe('webhook lifecycle', () => {
	it('creates a non-default endpoint and keeps its id and secret', async () => {
		const context = fakeContext({
			parameters: { events: ['render.succeeded'], templateIds: ['tpl_1'], options: {} },
			handler: () => ({ statusCode: 201, body: { id: 'whe_1', url: '', events: [], secret: SECRET } }),
		});
		expect(await hooks.create.call(context as unknown as IHookFunctions)).toBe(true);
		expect(context.calls[0]).toMatchObject({ method: 'POST', url: `${API}/webhook-endpoints` });
		expect(context.calls[0]!.body).toEqual({
			url: 'https://n8n.example.com/webhook/abc/webhook',
			events: ['render.succeeded'],
			description: 'n8n: Invoices',
			template_ids: ['tpl_1'],
			is_default: false,
		});
		expect(context.staticData).toEqual({ webhookId: 'whe_1', webhookSecret: SECRET });
		// Only "Listen for test event" asks for a sample.
		expect(context.calls).toHaveLength(1);
	});

	it('asks for a sample event when listening in the editor', async () => {
		const context = fakeContext({
			mode: 'manual',
			parameters: { events: ['batch.completed'], templateIds: [], options: {} },
			handler: (call) =>
				call.url.endsWith('/test')
					? { statusCode: 202, body: { object: 'webhook_test' } }
					: { statusCode: 201, body: { id: 'whe_2', secret: SECRET } },
		});
		await hooks.create.call(context as unknown as IHookFunctions);
		expect(context.calls[1]).toMatchObject({ url: `${API}/webhook-endpoints/whe_2/test`, body: { event: 'batch.completed' } });
	});

	it('keeps a matching endpoint and replaces one set up for other events', async () => {
		const endpoint = { id: 'whe_1', url: 'https://n8n.example.com/webhook/abc/webhook', events: ['render.succeeded'], template_ids: [] };
		const matching = fakeContext({
			parameters: { events: ['render.succeeded'], templateIds: [] },
			staticData: { webhookId: 'whe_1', webhookSecret: SECRET },
			handler: () => ({ statusCode: 200, body: endpoint }),
		});
		expect(await hooks.checkExists.call(matching as unknown as IHookFunctions)).toBe(true);

		const stale = fakeContext({
			parameters: { events: ['render.failed'], templateIds: [] },
			staticData: { webhookId: 'whe_1', webhookSecret: SECRET },
			handler: (call) => (call.method === 'GET' ? { statusCode: 200, body: endpoint } : { statusCode: 204 }),
		});
		expect(await hooks.checkExists.call(stale as unknown as IHookFunctions)).toBe(false);
		expect(stale.calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
		expect(stale.staticData).toEqual({});
	});

	it('deletes the endpoint, also when it is already gone', async () => {
		const context = fakeContext({
			staticData: { webhookId: 'whe_1', webhookSecret: SECRET },
			handler: () => ({ statusCode: 404, body: { detail: 'Not found.' } }),
		});
		expect(await hooks.delete.call(context as unknown as IHookFunctions)).toBe(true);
		expect(context.calls[0]).toMatchObject({ method: 'DELETE', url: `${API}/webhook-endpoints/whe_1` });
		expect(context.staticData).toEqual({});
	});
});

describe('deliveries', () => {
	function delivery(body: object, options: { secret?: string; parameters?: Record<string, unknown>; handler?: Handler } = {}) {
		vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
		const raw = Buffer.from(JSON.stringify(body));
		const signature = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
			.update(`evt_1.1000.${raw.toString()}`)
			.digest('base64');
		return fakeContext({
			parameters: { options: {}, ...options.parameters },
			staticData: { webhookId: 'whe_1', webhookSecret: options.secret ?? SECRET },
			handler: options.handler,
			webhook: {
				rawBody: raw,
				headers: { 'webhook-id': 'evt_1', 'webhook-timestamp': '1000', 'webhook-signature': `v1,${signature}` },
				body,
			},
		});
	}
	const event = (object: object, type = 'render.succeeded') => ({ id: 'evt_1', type, created_at: '', data: { object } });

	it('refuses a delivery with a wrong signature', async () => {
		const context = delivery(event(render()), { secret: `whsec_${Buffer.from('x'.repeat(32)).toString('base64')}` });
		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(context.responses[0]).toMatchObject({ status: 401 });
	});

	it('starts the workflow with the fresh render', async () => {
		const context = delivery(event(render({ source: 'api', files: [] })), {
			handler: () => ({ statusCode: 200, body: render({ source: 'api' }) }),
		});
		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);
		const json = result.workflowData![0]![0]!.json as { data: { object: { files: unknown[] } } };
		expect(json.data.object.files).toHaveLength(1);
		expect(context.calls[0]).toMatchObject({ method: 'GET', url: `${API}/renders/rnd_1` });
	});

	it("skips renders made in n8n unless asked, and filters test renders", async () => {
		const own = delivery(event(render({ source: 'n8n' })));
		expect(await trigger.webhook.call(own as unknown as IWebhookFunctions)).toEqual({});

		const included = delivery(event(render({ source: 'n8n' })), {
			parameters: { options: { n8nRenders: 'include', fetchRender: false } },
		});
		expect((await trigger.webhook.call(included as unknown as IWebhookFunctions)).workflowData).toHaveLength(1);

		const test = delivery(event(render({ source: 'api', test: true })), { parameters: { options: { testRenders: 'exclude' } } });
		expect(await trigger.webhook.call(test as unknown as IWebhookFunctions)).toEqual({});
	});

	it('passes sample events through without filters or refetching', async () => {
		const context = delivery(event(render({ source: 'n8n', reference: 'test_event', test: true })), {
			parameters: { options: { testRenders: 'exclude' } },
		});
		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);
		expect(result.workflowData).toHaveLength(1);
		expect(context.calls).toHaveLength(0);
	});

	it('passes other events through as they are', async () => {
		const context = delivery(event({ id: 'bat_1', object: 'batch' }, 'batch.completed'));
		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);
		expect(result.workflowData![0]![0]!.json).toMatchObject({ type: 'batch.completed', data: { object: { id: 'bat_1' } } });
	});
});
