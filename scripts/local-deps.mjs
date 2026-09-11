/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// @ts-check

import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const environmentFile = join(repositoryRoot, '.config', 'docker.env');
const environmentTemplate = join(repositoryRoot, '.config', 'docker_example.env');
const composeFile = join(repositoryRoot, 'compose.local-db.yml');

const command = process.argv[2] ?? 'up';
const extraArguments = process.argv.slice(3);

function ensureEnvironmentFile() {
	if (!existsSync(environmentFile)) {
		copyFileSync(environmentTemplate, environmentFile);
		console.log(`Created ${environmentFile} from the local development template.`);
	}
}

function compose(arguments_) {
	const result = spawnSync('docker', [
		'compose',
		'--env-file', environmentFile,
		'-f', composeFile,
		...arguments_,
	], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});

	if (result.error != null) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

ensureEnvironmentFile();

switch (command) {
	case 'up':
		compose(['up', '-d', '--wait', ...extraArguments]);
		break;
	case 'search':
		compose(['--profile', 'search', 'up', '-d', '--wait', ...extraArguments]);
		break;
	case 'down':
		compose(['down', ...extraArguments]);
		break;
	case 'restart':
		compose(['restart', ...extraArguments]);
		break;
	case 'status':
		compose(['ps', ...extraArguments]);
		break;
	case 'logs':
		compose(['logs', '-f', ...extraArguments]);
		break;
	case 'reset':
		if (!extraArguments.includes('--confirm')) {
			console.error('Refusing to delete data volumes. Run: pnpm dev:deps:reset --confirm');
			process.exit(1);
		}
		compose(['down', '--volumes', '--remove-orphans']);
		break;
	default:
		console.error(`Unknown command: ${command}`);
		console.error('Available commands: up, search, down, restart, status, logs, reset');
		process.exit(1);
}
