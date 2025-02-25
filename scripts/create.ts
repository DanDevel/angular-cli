/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/* eslint-disable import/no-extraneous-dependencies, no-prototype-builtins */
import { logging } from '@angular-devkit/core';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { packages } from '../lib/packages';
import build from './build';
import { promisify } from 'util';

const cli = promisify(require('@angular/cli/lib/cli'));

interface CreateOptions {
  _: string[];
}

async function ng(command: string, ...args: string[]) {
  const exitCode = await cli({
    cliArgs: [command, ...args],
  });

  if (exitCode !== 0) {
    throw new Error('Could not call ng. See above for more details. Error code: ' + exitCode);
  }
}

async function exec(
  command: string,
  args: string[],
  opts: { cwd?: string },
  logger: logging.Logger,
) {
  const { status, error, stderr, stdout } = spawnSync(command, args, { ...opts, encoding: 'utf-8' });

  if (status !== 0) {
    logger.error(`Command failed: ${command} ${args.map((x) => JSON.stringify(x)).join(', ')}`);
    if (error) {
      logger.error('Error: ' + (error ? error.message : 'undefined'));
    } else {
      logger.error(`STDERR:\n${stderr}`);
    }
    throw error;
  }

  return { stdout };
}

export default async function createProject(
  args: CreateOptions,
  logger: logging.Logger,
  cwd: string,
): Promise<number> {
  const projectName = args._[0];

  const oldCwd = process.cwd();
  logger.info('Building...');
  await build({ local: true }, logger.createChild('build'));

  process.chdir(cwd);
  logger.info('Creating project...');
  await ng('new', projectName, '--skip-install', '--skip-git', '--no-interactive');

  logger.info('Updating package.json...');
  const packageJsonPath = path.join(projectName, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  packageJson.dependencies ??= {};
  packageJson.devDependencies ??= {};

  // Set the dependencies to the new build we just used.
  for (const packageName of Object.keys(packages)) {
    if (packageJson.dependencies.hasOwnProperty(packageName)) {
      packageJson.dependencies[packageName] = packages[packageName].tar;
    } else if (packageJson.devDependencies.hasOwnProperty(packageName)) {
      packageJson.devDependencies[packageName] = packages[packageName].tar;
    }
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

  logger.info('Installing npm packages...');
  await exec('npm', ['install'], { cwd: path.join(cwd, projectName) }, logger);

  process.chdir(oldCwd);

  return 0;
}
