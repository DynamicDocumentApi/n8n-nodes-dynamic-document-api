import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DynamicDocumentApiApi implements ICredentialType {
	name = 'dynamicDocumentApiApi';

	displayName = 'Dynamic Document API';

	icon: Icon = {
		light: 'file:../nodes/DynamicDocumentApi/dynamicDocumentApi.svg',
		dark: 'file:../nodes/DynamicDocumentApi/dynamicDocumentApi.dark.svg',
	};

	documentationUrl = 'https://dynamicdocumentapi.com/docs/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key under API keys in the dashboard. A test key (dda_test_…) makes free test renders with a TEST watermark; a live key (dda_live_…) makes final, billed renders.',
		},
		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			options: [{ name: 'EU (Germany)', value: 'eu' }],
			default: 'eu',
			description: 'The region your workspace renders and stores files in',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Works with every key preset: listing templates only needs `templates:read`.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '=https://api-{{$credentials.region}}.dynamicdocumentapi.com/v1',
			url: '/templates',
			qs: { limit: 1 },
		},
	};
}
