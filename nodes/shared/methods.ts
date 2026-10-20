/** Lists the nodes load in the editor: templates, signed links and a template's data fields. */
import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperFields,
} from 'n8n-workflow';

import { templateFields } from './fields';
import { apiRequest } from './transport';
import type { Page, SignedLink, Template, TemplateSchema, TemplateType } from './types';

const TYPE_LABELS: Record<TemplateType, string> = {
	pdf_code: 'PDF',
	pdf_markdown: 'Markdown PDF',
	image_canvas: 'Image',
	docx: 'Word',
	pdf_form: 'PDF form',
};

/** Which template types a resource can render. */
function typesFor(resource: unknown): { type?: string; exclude?: TemplateType } {
	if (resource === 'image') return { type: 'image_canvas' };
	if (resource === 'document') return { exclude: 'image_canvas' };
	return {};
}

/** Published templates for a resource locator, searchable by name, paged by cursor. */
export async function searchTemplates(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const resource = this.getCurrentNodeParameter('resource');
	const { type, exclude } = typesFor(resource);
	// Renders need a published template; the Template resource also reads drafts.
	const publishedOnly = resource !== 'template';
	const page = (await apiRequest.call(this, 'GET', '/templates', {
		qs: { q: filter, cursor: paginationToken, limit: 100, type },
	})) as Page<Template>;
	return {
		results: page.data
			.filter((template) => (!publishedOnly || template.live_version) && template.type !== exclude)
			.map((template) => ({ name: `${template.name} (${TYPE_LABELS[template.type] ?? template.type})`, value: template.id })),
		paginationToken: page.has_more ? (page.next_cursor ?? undefined) : undefined,
	};
}

/** Signed links for a resource locator, searchable by name. */
export async function searchSignedLinks(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	// The list has no paging: a workspace has few signed links.
	const page = (await apiRequest.call(this, 'GET', '/signed-links')) as Page<SignedLink>;
	const needle = filter?.trim().toLowerCase();
	return {
		results: page.data
			.filter((link) => !needle || (link.name ?? link.id).toLowerCase().includes(needle))
			.map((link) => ({ name: link.name || link.id, value: link.id })),
	};
}

/** Every published template, for the trigger's template filter. */
export async function getTemplateOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const options: INodePropertyOptions[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 10; page++) {
		const result = (await apiRequest.call(this, 'GET', '/templates', {
			qs: { cursor, limit: 100 },
		})) as Page<Template>;
		for (const template of result.data) {
			if (template.live_version) options.push({ name: template.name, value: template.id });
		}
		if (!result.has_more || !result.next_cursor) break;
		cursor = result.next_cursor;
	}
	return options;
}

/** The selected template's data fields for the resource mapper. */
export async function getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const templateId = this.getCurrentNodeParameter('template', { extractValue: true }) as string | undefined;
	if (!templateId) return { fields: [], emptyFieldsNotice: 'Choose a template first.' };
	const schema = (await apiRequest.call(
		this,
		'GET',
		`/templates/${encodeURIComponent(templateId)}/schema`,
	)) as TemplateSchema;
	const fields = templateFields(schema);
	return fields.length
		? { fields }
		: { fields, emptyFieldsNotice: 'This template declares no data fields. Switch Data Entry to "Using JSON".' };
}
