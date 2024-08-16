import path, { dirname, join } from 'node:path';

import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { findWorkspacePackages } from '@pnpm/find-workspace-packages';
import { packlist } from '@pnpm/fs.packlist';
import { readExactProjectManifest } from '@pnpm/read-project-manifest';
import Debug from 'debug';
import resolvePackageManifestPath from 'resolve-package-path';

const debug = Debug('sync-pnpm');

/**
 * @param {string} dir the current working directory or the directory of a project
 */
export async function getPackagesToSync(dir) {
  const root = await findWorkspaceDir(dir);

  if (!root) {
    throw new Error(`Could not find workspace root`);
  }

  const localManifestPath = path.join(dir, 'package.json');
  const ownProject = await readExactProjectManifest(localManifestPath);
  const injectedDependencyNames = injectedDeps({ dir, ...ownProject });

  /**
   * If dependencies are not injected, we don't need to re-link
   */
  if (!injectedDependencyNames || injectedDependencyNames?.size === 0) {
    return [];
  }

  const localProjects = await findWorkspacePackages(root);

  return Promise.all(
    localProjects
      .filter((p) => {
        if (!p.manifest.name) return false;

        return injectedDependencyNames.has(p.manifest.name);
      })
      .map((project) => {
        const resolvedPackagePath = resolvePackagePath(
          project.manifest.name ?? '',
          dir
        );

        return {
          project,
          targetDir: resolvedPackagePath,
        };
      })
      .filter(({ project, targetDir }) => {
        if (project.dir === targetDir) {
          debug(
            `destination (${targetDir}) is the same as source (${project.dir}), this library (${project.manifest.name}) is not an injected dependency. Did you accidentally use package.json#overrides on an in-monorepo package?`
          );
        }

        return project.dir !== targetDir;
      })
      .map(async ({ project, targetDir }) => {
        return {
          project,
          targetDir,
          filesToSync: await getPackageFilesToSync(project, targetDir),
        };
      })
  );
}

/**
 * @typedef {Awaited<ReturnType<typeof findWorkspacePackages>>[number]} Project
 *
 * @param {Project} project
 * @param {string} targetDir
 */
async function getPackageFilesToSync(project, targetDir) {
  /** @type { { [syncFrom: string]: string } } */
  const pathsToSync = {};
  const name = project.manifest.name ?? '';

  const files = await packlist(project.dir, {
    [path.join(project.dir, 'package.json')]: project.manifest,
  });

  debug(
    `${name}'s packlist resolved to ${files}:\n` +
      `  Source: ${project.dir}\n` +
      `  Destination: ${targetDir}`
  );

  for (const file of files) {
    const syncFrom = join(project.dir, file);
    const syncTo = join(targetDir, file);

    pathsToSync[syncFrom] = syncTo;
  }

  return pathsToSync;
}

/**
 * @param {Project} project
 */
function injectedDeps(project) {
  const ownPackageJson = project.manifest;

  const depMeta = ownPackageJson.dependenciesMeta;

  if (!depMeta) return;

  const injectedDependencyNames = new Set();

  for (const [depName, meta] of Object.entries(depMeta)) {
    if (meta.injected) {
      injectedDependencyNames.add(depName);
    }
  }

  return injectedDependencyNames;
}

/**
 * @param {string} name
 * @param {string} startingDirectory resolve from here
 */
function resolvePackagePath(name, startingDirectory) {
  const resolvedManifestPath = resolvePackageManifestPath(
    name,
    startingDirectory
  );

  if (!resolvedManifestPath) {
    throw new Error(`Could not find package, ${name}`);
  }

  const resolvedPackagePath = dirname(resolvedManifestPath);

  return resolvedPackagePath;
}
