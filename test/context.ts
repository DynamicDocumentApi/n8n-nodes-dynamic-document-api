/**
 * A stand-in for the n8n function contexts (execute, load options, hooks, webhooks): parameters from a plain object,
 * HTTP calls answered by a handler and recorded, binary data kept as base64.
 */
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

export interface RecordedCall {
	method: string;
	url: string;
	qs?: IDataObject;
	body?: unknown;
	headers: IDataObject;
	authenticated: boolean;
}

export type Answer = { statusCode: number; body?: unknown };
export type Handler = (call: RecordedCall) => Answer | Buffer;

export interface FakeOptions {
	parameters?: Record<string, unknown>;
	items?: INodeExecutionData[];
	handler?: Handler;
	staticData?: IDataObject;
	mode?: string;
	executionId?: string;
	webhook?: { rawBody: Buffer; headers: Record<string, string>; body: unknown };
}

export function fakeContext(options: FakeOptions = {}) {
	const calls: RecordedCall[] = [];
	const staticData = options.staticData ?? {};
	const items: INodeExecutionData[] = options.items ?? [{ json: {} }];
	const responses: Array<{ status: number; body: unknown }> = [];
	const handler: Handler = options.handler ?? (() => ({ statusCode: 200, body: {} }));

	const parameter = (name: string, fallback?: unknown, extract?: boolean) => {
		const value = name in (options.parameters ?? {}) ? options.parameters![name] : fallback;
		if (extract && value && typeof value === 'object' && 'value' in (value as IDataObject)) {
			return (value as IDataObject).value;
		}
		return value;
	};

	const respond = (call: RecordedCall) => {
		calls.push(call);
		return handler(call);
	};

	const context = {
		calls,
		staticData,
		responses,
		getInputData: () => items,
		getNodeParameter: (name: string, _item?: number | unknown, fallback?: unknown, opts?: { extractValue?: boolean }) =>
			typeof _item === 'number' || _item === undefined
				? parameter(name, fallback, opts?.extractValue)
				: parameter(name, _item),
		getCurrentNodeParameter: (name: string, opts?: { extractValue?: boolean }) =>
			parameter(name, undefined, opts?.extractValue),
		getCredentials: async () => ({ apiKey: 'dda_test_key', region: 'eu' }),
		getNode: () => ({
			id: 'node-1',
			name: 'Dynamic Document API',
			type: '@dynamic-document-api/n8n-nodes-dynamic-document-api.dynamicDocumentApi',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getExecutionId: () => options.executionId ?? 'exec-1',
		continueOnFail: () => false,
		getMode: () => options.mode ?? 'trigger',
		getWorkflow: () => ({ id: 'wf-1', name: 'Invoices', active: true }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getRequestObject: () => ({ rawBody: options.webhook?.rawBody }),
		getHeaderData: () => options.webhook?.headers ?? {},
		getBodyData: () => options.webhook?.body ?? {},
		getResponseObject: () => {
			const response = {
				code: 200,
				status(code: number) {
					response.code = code;
					return response;
				},
				json(body: unknown) {
					responses.push({ status: response.code, body });
					return response;
				},
			};
			return response;
		},
		helpers: {
			httpRequestWithAuthentication: async (_credential: string, request: IDataObject) => {
				const answer = respond({
					method: String(request.method),
					url: String(request.url),
					qs: request.qs as IDataObject | undefined,
					body: request.body,
					headers: (request.headers as IDataObject) ?? {},
					authenticated: true,
				});
				if (Buffer.isBuffer(answer)) throw new Error('API calls answer JSON');
				return { statusCode: answer.statusCode, body: answer.body, headers: {} };
			},
			httpRequest: async (request: IDataObject) => {
				const answer = respond({
					method: String(request.method),
					url: String(request.url),
					headers: (request.headers as IDataObject) ?? {},
					authenticated: false,
				});
				return Buffer.isBuffer(answer) ? answer : Buffer.from(JSON.stringify(answer.body ?? ''));
			},
			prepareBinaryData: async (buffer: Buffer, fileName?: string, mimeType?: string) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
			assertBinaryData: (itemIndex: number, property: string) => {
				const binary = items[itemIndex]?.binary?.[property];
				if (!binary) throw new Error(`No binary field "${property}"`);
				return binary;
			},
			getBinaryDataBuffer: async (itemIndex: number, property: string) =>
				Buffer.from(items[itemIndex]!.binary![property]!.data, 'base64'),
			returnJsonArray: (values: IDataObject[]) => values.map((json) => ({ json })),
		},
	};
	return context;
}

/** A render as the API answers it. */
export function render(overrides: IDataObject = {}): IDataObject {
	return {
		id: 'rnd_1',
		object: 'render',
		status: 'succeeded',
		mode: 'sync',
		test: true,
		source: 'n8n',
		pages: 1,
		billed_renders: 0,
		reference: null,
		warnings: [],
		error: null,
		files: [
			{
				id: 'file_1',
				filename: 'invoice.pdf',
				format: 'pdf',
				bytes: 1234,
				pages: 1,
				url: 'https://files.example.com/rnd_1/invoice.pdf?sig=abc',
				url_expires_at: '2026-10-21T09:30:00Z',
			},
		],
		created_at: '2026-10-20T09:30:00Z',
		completed_at: '2026-10-20T09:30:01Z',
		...overrides,
	};
}
