import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input)
	throw new Error('Usage: node scripts/generate-catalog.mjs path/to/discovered-endpoints.json');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const display = (text) =>
	text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replaceAll('_', ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
const records = source.endpoints.map((item) => ({
	id: `${item.method}:${item.path}`,
	name: display(item.names[0] ?? item.path.split('/').at(-2) ?? item.group),
	group: item.group,
	path: item.path,
	method: item.method,
	fields: item.fields,
	sourceFiles: item.sources,
	versionEvidence: item.versionFromConstant ? 'frontend-constant' : 'client-default',
	liveVerified: false,
}));
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(
	path.join(root, 'nodes/FanqieAuthor/catalog.ts'),
	`// Generated from public frontend endpoint metadata; these are candidates, not live verification results.\nimport type { Endpoint } from './types';\n\nexport const endpoints: Endpoint[] = ${JSON.stringify(records, null, 2)};\n`,
);
fs.writeFileSync(
	path.join(root, 'docs/endpoint-catalog.json'),
	JSON.stringify(
		{
			discoveredAt: source.discoveredAt,
			sourcePage: source.sourcePage,
			total: records.length,
			liveVerifiedCount: 0,
			endpoints: records,
		},
		null,
		2,
	) + '\n',
);
console.log(`Generated ${records.length} endpoint candidates`);
