import fs from 'node:fs/promises';
import path, { join } from 'node:path';

import { depPathToFilename } from '@pnpm/dependency-path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { packlist } from '@pnpm/fs.packlist';
import { readWantedLockfile } from '@pnpm/lockfile.fs';
import { readExactProjectManifest } from '@pnpm/read-project-manifest';
import Debug from 'debug';

const debug = Debug('sync-pnpm');

/**
 * @typedef {import('@pnpm/types').Project} Project
 */

/**
 * @param {Project['rootDir']} dir the current working directory or the directory of a project
 */
export async function getPackagesToSync(dir) {
  const root = await findWorkspaceDir(dir);

  if (!root) {
    throw new Error(`Could not find workspace root`);
  }

  const localManifestPath = path.join(dir, 'package.json');
  const project = {
    dir,
    ...(await readExactProjectManifest(localManifestPath)),
  };
  const injectionPaths = await getInjectionPaths(root, project);

  if (injectionPaths.length === 0) {
    return { project, injectionPaths, filesToSync: {} };
  }

  return {
    project,
    injectionPaths,
    filesToSync: await getPackageFilesToSync(project, injectionPaths),
  };
}

/**
 *
 * @param {Project & { dir: string }} project
 * @param {string[]} injectionPaths
 */
async function getPackageFilesToSync(project, injectionPaths) {
  /** @type { { [syncFrom: string]: string[] } } */
  const pathsToSync = {};
  const name = project.manifest.name ?? '';

  const files = await packlist(project.dir, {
    [path.join(project.dir, 'package.json')]: project.manifest,
  });

  debug(
    `${name}'s packlist resolved to ${files}:\n` +
      `  Source: ${project.dir}\n` +
      `  Destination: ${injectionPaths}`
  );

  for (const file of files) {
    const syncFrom = join(project.dir, file);

    pathsToSync[syncFrom] = injectionPaths.map((targetDir) =>
      join(targetDir, file)
    );
  }

  return pathsToSync;
}

/**
 * @param {string} root
 * @param {Project} project
 */
async function getInjectionPaths(root, project) {
  const lockfile = await readWantedLockfile(root, { ignoreIncompatible: true });

  if (!lockfile) return [];

  /** @type {Set<string>} */
  let injectedDependencyToVersion = new Set();

  Object.values(lockfile.importers).forEach((importer) => {
    getInjectedDependencyToVersion(
      importer.dependencies,
      project.manifest.name,
      injectedDependencyToVersion
    );
    getInjectedDependencyToVersion(
      importer.optionalDependencies,
      project.manifest.name,
      injectedDependencyToVersion
    );
    getInjectedDependencyToVersion(
      importer.devDependencies,
      project.manifest.name,
      injectedDependencyToVersion
    );
  });

  if (lockfile.packages) {
    Object.values(lockfile.packages).forEach((pack) => {
      getInjectedDependencyToVersion(
        pack.dependencies,
        project.manifest.name,
        injectedDependencyToVersion
      );
      getInjectedDependencyToVersion(
        pack.optionalDependencies,
        project.manifest.name,
        injectedDependencyToVersion
      );
    });
  }

  /**
   * @type {Set<string>}
   */
  const injectedDependencyToFilePathSet = new Set();

  for (const injectedDependencyVersion of injectedDependencyToVersion) {
    // this logic is heavily depends on pnpm-lock formate
    // the current logic is for pnpm v8
    // for example: file:../../libraries/lib1(react@16.0.0) -> ../../libraries/lib1
    let injectedDependencyPath = injectedDependencyVersion
      .split('(')[0]
      .slice('file:'.length);

    injectedDependencyPath = path.resolve(root, injectedDependencyPath);

    const fullPackagePath = path.join(
      path.resolve(root, 'node_modules', '.pnpm'),
      depPathToFilename(
        `${project.manifest.name}@${injectedDependencyVersion}`,
        120
      ),
      'node_modules',
      project.manifest.name
    );

    injectedDependencyToFilePathSet.add(fullPackagePath);
  }

  return [...injectedDependencyToFilePathSet.values()];
}

/**
 * @typedef {import('@pnpm/lockfile.fs').ResolvedDependencies} ResolvedDependencies
 *
 * @param {ResolvedDependencies | undefined} dependencies
 * @param {string} wantedDependency
 * @param {Set<string>} injectedDependencyToVersion
 * */
function getInjectedDependencyToVersion(
  dependencies,
  wantedDependency,
  injectedDependencyToVersion
) {
  if (!dependencies) return;

  for (const [dependency, specifier] of Object.entries(dependencies)) {
    if (dependency !== wantedDependency) continue;
    // the injected dependency should always start with file protocol
    // and exclude tarball installation
    // what is the tarball installation, learn more: https://pnpm.io/cli/add#install-from-local-file-system

    const tarballSuffix = ['.tar', '.tar.gz', '.tgz'];

    if (
      specifier.startsWith('file:') &&
      !tarballSuffix.some((suffix) => specifier.endsWith(suffix))
    ) {
      injectedDependencyToVersion.add(specifier);
    }
  }
}
