import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PACKAGE_VERSION, apiBaseUrl } from '../nodes/shared/constants';
import { dataFromMappedValues, fieldLabel, templateFields } from '../nodes/shared/fields';
import { describeProblem, hintFor } from '../nodes/shared/problem';
import { envelope, imageOptions, keyValues, pdfOptions, simplifyRender } from '../nodes/shared/render';
import type { Render } from '../nodes/shared/types';
import { verifySignature } from '../nodes/shared/webhooks';
import pkg from '../package.json';
import { render } from './context';

describe('constants', () => {
	it('keeps the User-Agent version equal to package.json', () => {
		expect(PACKAGE_VERSION).toBe(pkg.version);
	});

	it('builds the region host and falls back to EU', () => {
		expect(apiBaseUrl('eu')).toBe('https://api-eu.dynamicdocumentapi.com/v1');
		expect(apiBaseUrl('../evil')).toBe('https://api-eu.dynamicdocumentapi.com/v1');
	});
});

describe('templateFields', () => {
	const schema = {
		schema: {
			type: 'object',
			required: ['number', 'customer', 'lines'],
			properties: {
				number: { type: 'string' },
				total: { type: 'number' },
				paid: { type: 'boolean' },
				status: { type: 'string', enum: ['draft', 'final'] },
				customer: {
					type: 'object',
					required: ['name'],
					properties: { name: { type: 'string' }, vatId: { type: 'string' } },
				},
				delivery: {
					type: 'object',
					required: ['date'],
					properties: { date: { type: 'string', format: 'date' } },
				},
				lines: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' } } } },
				tags: { type: 'array', items: { type: 'string' } },
			},
		},
	};

	it('flattens nested objects into dotted ids with readable labels', () => {
		const fields = templateFields(schema);
		expect(fields.map((field) => field.id)).toEqual([
			'number',
			'total',
			'paid',
			'status',
			'customer.name',
			'customer.vatId',
			'delivery.date',
			'lines',
			'tags',
		]);
		expect(fields.find((field) => field.id === 'customer.vatId')?.displayName).toBe('Customer › Vat Id');
		expect(fieldLabel('line_items')).toBe('Line Items');
	});

	it('types the fields and requires a nested field only under a required parent', () => {
		const byId = Object.fromEntries(templateFields(schema).map((field) => [field.id, field]));
		expect(byId.total?.type).toBe('number');
		expect(byId.paid?.type).toBe('boolean');
		expect(byId.status?.type).toBe('options');
		expect(byId.status?.options).toEqual([
			{ name: 'draft', value: 'draft' },
			{ name: 'final', value: 'final' },
		]);
		expect(byId.lines?.type).toBe('array');
		expect(byId['customer.name']?.required).toBe(true);
		expect(byId['delivery.date']?.required).toBe(false);
		expect(byId.number?.required).toBe(true);
	});

	it("uses an image template's dynamic properties", () => {
		const fields = templateFields({
			dynamic_properties: [
				{ key: 'title.text', type: 'string' },
				{ key: 'badge.visible', type: 'boolean' },
			],
		});
		expect(fields.map((field) => [field.id, field.displayName, field.type])).toEqual([
			['title.text', 'Title › Text', 'string'],
			['badge.visible', 'Badge › Visible', 'boolean'],
		]);
	});
});

describe('dataFromMappedValues', () => {
	it('rebuilds nested data, coerces types and leaves out blanks', () => {
		const fields = templateFields({
			schema: {
				type: 'object',
				properties: {
					total: { type: 'number' },
					paid: { type: 'boolean' },
					customer: { type: 'object', properties: { name: { type: 'string' } } },
					lines: { type: 'array', items: { type: 'object' } },
					tags: { type: 'array', items: { type: 'string' } },
					note: { type: 'string' },
				},
			},
		});
		const data = dataFromMappedValues(
			{
				total: '12.5',
				paid: 'yes',
				'customer.name': 'Ada',
				lines: '[{"item":"Consulting"}]',
				tags: 'a, b',
				note: '  ',
			},
			fields,
		);
		expect(data).toEqual({
			total: 12.5,
			paid: true,
			customer: { name: 'Ada' },
			lines: [{ item: 'Consulting' }],
			tags: ['a', 'b'],
		});
	});
});

describe('problems', () => {
	it('joins the detail, field errors and the render', () => {
		expect(
			describeProblem(
				{ detail: 'Invalid data.', errors: [{ path: '/data/total', message: 'must be a number' }], render_id: 'rnd_9' },
				422,
			),
		).toBe('Invalid data. /data/total: must be a number Render rnd_9.');
		expect(describeProblem({}, 500)).toBe('The API answered 500.');
	});

	it('explains the webhook URL rule and missing scopes', () => {
		expect(hintFor(400, { errors: [{ path: '/url', message: 'port not allowed' }] })).toContain('https');
		expect(hintFor(403, { code: 'insufficient_scope' })).toContain('scopes');
		expect(hintFor(401, {})).toContain('API key');
	});
});

describe('request options', () => {
	it('builds the envelope with a 24-hour link', () => {
		expect(
			envelope({ fileName: 'a.pdf', reference: 'order-1', metadata: { values: [{ key: 'k', value: 'v' }] } }),
		).toEqual({ delivery: { expires_in: 86400 }, filename: 'a.pdf', reference: 'order-1', metadata: { k: 'v' } });
		expect(envelope({ fileName: 'a.pdf' }, false)).toEqual({ delivery: { expires_in: 86400 } });
		expect(keyValues({ values: [{ key: ' ', value: 'x' }] })).toBeUndefined();
	});

	it('maps PDF and image options', () => {
		expect(
			pdfOptions({ paperSize: 'A4', margin: '20mm', headerHtml: '<b>x</b>', pdfA: '3b', pdfUa: true, printBackground: false }),
		).toEqual({
			paper: { size: 'A4' },
			margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
			header: { enabled: true, html: '<b>x</b>' },
			print_background: false,
			pdfa: '3b',
			pdfua: '1',
		});
		expect(pdfOptions({})).toBeUndefined();
		expect(imageOptions({ format: 'jpeg', width: 800, quality: 80, fullPage: true })).toEqual({
			format: 'jpeg',
			image: { width: 800, full_page: true, format_options: { quality: 80 } },
		});
	});

	it('simplifies a render', () => {
		const simple = simplifyRender(render({ warnings: [{ code: 'w', message: 'careful' }] }) as unknown as Render);
		expect(simple).toMatchObject({
			id: 'rnd_1',
			status: 'succeeded',
			filename: 'invoice.pdf',
			file_url: 'https://files.example.com/rnd_1/invoice.pdf?sig=abc',
			warnings: ['w: careful'],
		});
		expect(simplifyRender(render({ status: 'processing', files: [] }) as unknown as Render).hint).toContain('Still running');
	});
});

describe('verifySignature', () => {
	const secret = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
	const body = Buffer.from('{"id":"evt_1","type":"render.succeeded"}');
	const sign = (key: string, id: string, timestamp: number) =>
		createHmac('sha256', Buffer.from(key.replace('whsec_', ''), 'base64'))
			.update(`${id}.${timestamp}.${body.toString()}`)
			.digest('base64');

	it('accepts a valid signature, also next to a rotated one', () => {
		const headers = {
			'webhook-id': 'evt_1',
			'webhook-timestamp': '1000',
			'webhook-signature': `v1,${sign(`whsec_${Buffer.from('x'.repeat(32)).toString('base64')}`, 'evt_1', 1000)} v1,${sign(secret, 'evt_1', 1000)}`,
		};
		expect(verifySignature(body, headers, secret, 1010)).toEqual({ valid: true });
	});

	it('rejects a wrong signature, a stale timestamp and missing headers', () => {
		const good = sign(secret, 'evt_1', 1000);
		expect(
			verifySignature(body, { 'webhook-id': 'evt_1', 'webhook-timestamp': '1000', 'webhook-signature': 'v1,AAAA' }, secret, 1000),
		).toEqual({ valid: false, reason: 'signature mismatch' });
		expect(
			verifySignature(body, { 'webhook-id': 'evt_1', 'webhook-timestamp': '1000', 'webhook-signature': `v1,${good}` }, secret, 2000),
		).toEqual({ valid: false, reason: 'timestamp outside the tolerance' });
		expect(verifySignature(body, {}, secret, 1000)).toEqual({ valid: false, reason: 'missing signature headers' });
	});
});
