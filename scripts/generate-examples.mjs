import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manual = {
	id: 'manual',
	name: 'Run Manually',
	type: 'n8n-nodes-base.manualTrigger',
	typeVersion: 1,
	position: [200, 300],
	parameters: {},
};
const fanqie = (id, name, parameters, position) => ({
	id,
	name,
	parameters,
	position,
	type: 'n8n-nodes-fanqie.fanqieAuthor',
	typeVersion: 1,
});
const workflows = [
	{
		filename: 'account-and-books.json',
		name: 'Fanqie Author - Read Account and Books',
		nodes: [
			manual,
			fanqie(
				'account',
				'Read Account',
				{ resource: 'account', operation: 'get', parameters: '{}', options: {} },
				[440, 220],
			),
			fanqie(
				'books',
				'Read Books',
				{ resource: 'book', operation: 'getMany', returnAll: true, parameters: '{}', options: {} },
				[440, 420],
			),
		],
		connections: {
			'Run Manually': {
				main: [
					[
						{ node: 'Read Account', type: 'main', index: 0 },
						{ node: 'Read Books', type: 'main', index: 0 },
					],
				],
			},
		},
	},
	{
		filename: 'endpoint-catalog.json',
		name: 'Fanqie Author - Inspect Endpoint Catalog',
		nodes: [
			manual,
			fanqie(
				'catalog',
				'Inspect Catalog',
				{ resource: 'advanced', operation: 'getCatalog', apiGroup: '' },
				[460, 300],
			),
		],
		connections: {
			'Run Manually': { main: [[{ node: 'Inspect Catalog', type: 'main', index: 0 }]] },
		},
	},
];
fs.mkdirSync(path.join(root, 'examples'), { recursive: true });
for (const { filename, ...workflow } of workflows)
	fs.writeFileSync(
		path.join(root, 'examples', filename),
		JSON.stringify(
			{ ...workflow, active: false, settings: { executionOrder: 'v1' }, tags: [] },
			null,
			2,
		) + '\n',
	);
console.log(`Generated ${workflows.length} read-only workflows`);
