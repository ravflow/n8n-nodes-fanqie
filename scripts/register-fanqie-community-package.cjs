'use strict';

// Admin-only repair for a package that was installed from a local archive.
// Use n8n's own package loader and transactional repository, without reinstalling it.
const { createRequire } = require('node:module');
const appDirectory = process.env.FANQIE_N8N_APP_DIR || '/usr/local/lib/node_modules/n8n';
const appRequire = createRequire(appDirectory + '/package.json');
process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR || appDirectory + '/bin/config';
appRequire('reflect-metadata');
appRequire('./dist/config');
process.argv = [process.argv[0], __filename, 'fanqie-register-installed'];

const { Container } = appRequire('@n8n/di');
const { Command } = appRequire('@n8n/decorators');
const { BaseCommand } = appRequire('./dist/commands/base-command');
const { LoadNodesAndCredentials } = appRequire('./dist/load-nodes-and-credentials');
const { InstalledPackagesRepository } = appRequire(
	'./dist/modules/community-packages/installed-packages.repository',
);
const { CommunityPackagesService } = appRequire(
	'./dist/modules/community-packages/community-packages.service',
);

class RegisterFanqieInstalled extends BaseCommand {
	async run() {
		const packageName = 'n8n-nodes-fanqie';
		const nodeType = packageName + '.fanqieAuthor';
		const loaderService = Container.get(LoadNodesAndCredentials);
		const loader = loaderService.loaders[packageName];
		if (!loader || loader.packageJson.name !== packageName)
			throw new Error('The installed package was not loaded by n8n');
		loaderService.getNode(nodeType);
		if (!loader.loadedNodes.some((node) => node.name === 'fanqieAuthor'))
			throw new Error('The author node is not loaded; registration was not performed');
		const repository = Container.get(InstalledPackagesRepository);
		const existing = await repository.findOne({
			where: { packageName },
			relations: ['installedNodes'],
		});
		let action = 'alreadyRegistered';
		if (!existing) {
			await repository.saveInstalledPackageWithNodes(loader);
			action = 'registered';
		} else if (
			existing.installedVersion !== loader.packageJson.version ||
			!existing.installedNodes.some((node) => node.type === nodeType)
		) {
			if (
				process.env.FANQIE_REPLACE_INSTALLED_VERSION !== 'true' ||
				!existing.installedNodes.some((node) => node.type === nodeType)
			) {
				throw new Error(
					'An inconsistent existing registration was found; no existing record was overwritten',
				);
			}
			await repository.replaceInstalledPackageWithNodes(existing, loader);
			action = 'updatedInstalledVersion';
		}
		const service = Container.get(CommunityPackagesService);
		const rows = service.withLoadStatus(await service.getAllInstalledPackages());
		const entry = rows.find((row) => row.packageName === packageName);
		if (
			!entry ||
			entry.failedLoading ||
			!entry.installedNodes.some((node) => node.type === nodeType)
		)
			throw new Error('Community package list validation failed');
		console.log(
			JSON.stringify({
				action,
				packageName: entry.packageName,
				installedVersion: entry.installedVersion,
				failedLoading: entry.failedLoading,
				installedNodes: entry.installedNodes.map((node) => ({
					name: node.name,
					type: node.type,
					latestVersion: node.latestVersion,
				})),
			}),
		);
	}
}

Command({
	name: 'fanqie-register-installed',
	description: 'Register the existing local Fanqie community node package',
})(RegisterFanqieInstalled);

appRequire('./dist/command-registry').CommandRegistry;
Container.get(appRequire('./dist/command-registry').CommandRegistry)
	.execute()
	.catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
