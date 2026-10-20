/**
 * Response shapes of the public API (https://dynamicdocumentapi.com/docs/api-reference). Only the fields the nodes
 * read are typed; everything else passes through unchanged.
 */

export interface RenderFile {
	id: string;
	filename: string;
	format: string;
	bytes?: number | null;
	pages?: number | null;
	width?: number | null;
	height?: number | null;
	url?: string | null;
	url_expires_at?: string | null;
}

export type RenderStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'expired';

export interface Render {
	id: string;
	object: 'render';
	status: RenderStatus;
	mode?: string;
	test: boolean;
	source?: string | null;
	input_type?: string | null;
	kind?: string | null;
	output_format?: string | null;
	template?: { id: string; version?: number | null } | null;
	pages?: number | null;
	billed_renders?: number | null;
	reference?: string | null;
	metadata?: Record<string, unknown> | null;
	batch_id?: string | null;
	warnings?: Array<{ code: string; message: string }> | null;
	error?: { code: string; message: string } | null;
	result?: Record<string, unknown> | null;
	files: RenderFile[];
	created_at: string;
	completed_at?: string | null;
	expires_at?: string | null;
}

export interface BatchFile {
	kind: string;
	file_id: string;
	filename: string;
	content_type?: string | null;
	bytes?: number | null;
	pages?: number | null;
	url?: string | null;
	url_expires_at?: string | null;
}

export interface Batch {
	id: string;
	object: 'batch';
	status: string;
	total: number;
	succeeded?: number;
	failed?: number;
	pending?: number;
	test: boolean;
	files?: BatchFile[];
	error?: { code: string; message: string } | null;
	created_at: string;
	completed_at?: string | null;
}

export type TemplateType = 'pdf_code' | 'pdf_markdown' | 'image_canvas' | 'docx' | 'pdf_form';

export interface Template {
	id: string;
	name: string;
	type: TemplateType;
	live_version?: { id: string; number: number } | null;
}

export interface DynamicProperty {
	key: string;
	type: string;
	default?: unknown;
	max_length?: number | null;
}

export interface TemplateSchema {
	template_id?: string;
	version?: number | null;
	declared?: boolean;
	schema?: Record<string, unknown> | null;
	dynamic_properties?: DynamicProperty[];
}

export interface SignedLink {
	id: string;
	name?: string | null;
	template_id?: string | null;
	formats?: string[] | null;
	allowed_params?: string[] | null;
	enabled?: boolean;
}

export interface Page<T> {
	data: T[];
	has_more: boolean;
	next_cursor?: string | null;
}

export interface WebhookEndpoint {
	id: string;
	url: string;
	events: string[];
	template_ids?: string[] | null;
	secret?: string;
}

export interface WebhookEvent {
	id: string;
	type: string;
	created_at: string;
	workspace_id?: string;
	region?: string;
	data: { object?: Record<string, unknown>; [key: string]: unknown };
}

export interface Upload {
	id: string;
	filename: string;
}
