/**
 * Template data as n8n resource-mapper fields, and back. A template's JSON Schema becomes one field per value:
 * nested objects become dotted ids (`customer.name`, labelled "Customer › Name"), arrays (line items, lists) become
 * JSON fields, and an image template's dynamic properties (`title.text`) become plain fields. "Using JSON" covers
 * structures that fields can't express.
 */
import type { FieldType, IDataObject, ResourceMapperField } from 'n8n-workflow';

import type { TemplateSchema } from './types';

const MAX_FIELDS = 200;
const MAX_DEPTH = 6;

export interface JsonSchema {
	type?: string | string[];
	format?: string;
	description?: string;
	title?: string;
	enum?: unknown[];
	default?: unknown;
	examples?: unknown[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
}

function typeOf(schema: JsonSchema): string | undefined {
	const t = schema.type;
	if (Array.isArray(t)) return t.find((x) => x !== 'null');
	if (t) return t;
	if (schema.properties) return 'object';
	return undefined;
}

/** `customer.vatId` → `Customer › Vat Id`. */
export function fieldLabel(path: string): string {
	return path
		.split('.')
		.map((part) =>
			part
				.replace(/[_-]+/g, ' ')
				.replace(/([a-z])([A-Z])/g, '$1 $2')
				.trim()
				.replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
		)
		.join(' › ');
}

function fieldType(schema: JsonSchema): FieldType {
	const t = typeOf(schema);
	if (schema.enum?.length && (t === 'string' || t === undefined)) return 'options';
	if (t === 'integer' || t === 'number') return 'number';
	if (t === 'boolean') return 'boolean';
	if (t === 'array') return 'array';
	if (t === 'object') return 'object';
	return 'string';
}

function scalarField(path: string, schema: JsonSchema, required: boolean): ResourceMapperField {
	const type = fieldType(schema);
	const field: ResourceMapperField = {
		id: path,
		displayName: fieldLabel(path),
		required,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		type,
	};
	if (type === 'options') {
		field.options = (schema.enum ?? []).map((value) => ({ name: String(value), value: String(value) }));
	}
	return field;
}

/**
 * Fields for an object's properties. A field is required when its own object requires it and that object is itself
 * required, so an optional `delivery` with a required `delivery.date` stays optional.
 */
function objectFields(
	schema: JsonSchema,
	prefix: string,
	depth: number,
	fields: ResourceMapperField[],
	parentRequired: boolean,
): void {
	const required = new Set(schema.required ?? []);
	for (const [name, child] of Object.entries(schema.properties ?? {})) {
		if (fields.length >= MAX_FIELDS) return;
		const path = prefix ? `${prefix}.${name}` : name;
		const isRequired = parentRequired && required.has(name);
		if (typeOf(child) === 'object' && child.properties && depth < MAX_DEPTH) {
			objectFields(child, path, depth + 1, fields, isRequired);
		} else {
			fields.push(scalarField(path, child, isRequired));
		}
	}
}

/** Resource-mapper fields for a template, from `GET /v1/templates/{id}/schema`. */
export function templateFields(schema: TemplateSchema): ResourceMapperField[] {
	if (schema.dynamic_properties?.length) {
		return schema.dynamic_properties.slice(0, MAX_FIELDS).map((property) => ({
			id: property.key,
			displayName: fieldLabel(property.key),
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			type: property.type === 'boolean' ? 'boolean' : property.type === 'number' ? 'number' : 'string',
		}));
	}
	const fields: ResourceMapperField[] = [];
	objectFields((schema.schema ?? {}) as JsonSchema, '', 0, fields, true);
	return fields;
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function coerce(value: unknown, type: FieldType | undefined): unknown {
	if (type === 'number') {
		const n = typeof value === 'number' ? value : Number(String(value).trim());
		return Number.isFinite(n) ? n : value;
	}
	if (type === 'boolean') {
		if (typeof value === 'boolean') return value;
		const s = String(value).trim().toLowerCase();
		if (['true', 'yes', '1'].includes(s)) return true;
		if (['false', 'no', '0'].includes(s)) return false;
		return value;
	}
	if (type === 'array') {
		const parsed = parseJson(value);
		if (Array.isArray(parsed)) return parsed;
		// A comma list for an array of scalars, e.g. tags.
		return String(value)
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item !== '');
	}
	if (type === 'object') return parseJson(value);
	return value;
}

/** Sets `a.b.c` in `target`, creating the objects on the way. */
export function setPath(target: IDataObject, path: string, value: unknown): void {
	const parts = path.split('.');
	let node: IDataObject = target;
	for (const part of parts.slice(0, -1)) {
		const next = node[part];
		if (typeof next !== 'object' || next === null || Array.isArray(next)) node[part] = {};
		node = node[part] as IDataObject;
	}
	node[parts[parts.length - 1]] = value as IDataObject[keyof IDataObject];
}

/** The template's `data` object from the mapped values; blank values are left out. */
export function dataFromMappedValues(
	values: IDataObject | null | undefined,
	fields: ResourceMapperField[] = [],
): IDataObject {
	const types = new Map(fields.map((field) => [field.id, field.type]));
	const data: IDataObject = {};
	for (const [id, value] of Object.entries(values ?? {})) {
		if (isBlank(value)) continue;
		setPath(data, id, coerce(value, types.get(id)));
	}
	return data;
}
