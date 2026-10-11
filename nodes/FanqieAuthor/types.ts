import type { IDataObject } from 'n8n-workflow';

export interface Endpoint {
	id: string;
	name: string;
	group: string;
	path: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	fields: string[];
	sourceFiles: string[];
	versionEvidence: 'frontend-constant' | 'client-default';
	liveVerified: boolean;
}

export interface Operation {
	resource: string;
	value: string;
	name: string;
	action: string;
	path: string;
	method: Endpoint['method'];
	required?: string[];
	fields?: string[];
	defaults?: IDataObject;
	listKeys?: string[];
	pagination?: boolean;
	content?: boolean;
	recipe?: 'createDraft' | 'saveDraft' | 'publish' | 'schedule';
}

export interface RequestSettings {
	timeout: number;
	readRetries: number;
}
