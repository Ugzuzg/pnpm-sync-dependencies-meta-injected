import fs from 'node:fs/promises';
import { join } from 'node:path';

import Debug from 'debug';
import { debounce } from 'dettle';
import Watcher from 'watcher';

import { getPackagesToSync } from './detectors.js';
import { syncFile } from './syncFile.js';

const debug = Debug('sync-pnpm');
const DEBOUNCE_INTERVAL = 50;

/**
 * @param {string} dir the current working directory or the directory of a project
 */
export async function watchMode(dir) {
  debug('watch mode enabled');

  const watcher = new Watcher();

  /** @type {Set<string>} */
  let dirtyPaths = new Set();
  /** @type {Map<string, string>} */
  let unlinkPaths = new Map();

  async function handleDirtyPaths() {
    debug('handling dirty paths');

    const packageToSync = await getPackagesToSync(dir);

    await watcher.watchPaths(
      [packageToSync.project.dir],
      { recursive: true },
      () => {}
    );

    if (unlinkPaths.size) {
      await Promise.all(
        [...unlinkPaths.entries()].flatMap(async ([unlinkPath, event]) => {
          if (!unlinkPath.startsWith(packageToSync.project.dir)) return;

          return packageToSync.injectionPaths.map(async (targetDir) => {
            const pathToRemove = join(
              targetDir,
              unlinkPath.slice(packageToSync.project.dir.length + 1)
            );

            debug(`unlinking ${pathToRemove}`);
            /*
            await fs.rm(pathToRemove, {
              recursive: event === 'unlinkDir',
              force: true,
            });
            */
          });
        })
      );

      unlinkPaths = new Map();
    }

    if (dirtyPaths.size) {
      /** @type {{ [fromPath: string]: string[]}} */
      const syncTasks = {};

      for (const dirtyPath of dirtyPaths) {
        if (!dirtyPath.startsWith(packageToSync.project.dir)) return;

        if (packageToSync.filesToSync[dirtyPath]) {
          syncTasks[dirtyPath] = packageToSync.filesToSync[dirtyPath];
        } else {
          debug(`path not under watched root ${dirtyPath}`);
        }
      }

      dirtyPaths = new Set();

      await Promise.all(
        Object.entries(syncTasks).map(([syncFrom, syncToPaths]) =>
          syncToPaths.map((syncTo) => syncFile(syncFrom, syncTo))
        )
      );
    }
  }

  const debouncedHandleDirtyPaths = debounce(
    handleDirtyPaths,
    DEBOUNCE_INTERVAL
  );

  watcher.on('all', (_event, targetPath /*, targetPathNext*/) => {
    if (_event.startsWith('unlink')) {
      unlinkPaths.set(targetPath, _event);
    } else {
      dirtyPaths.add(targetPath);
    }

    debouncedHandleDirtyPaths();
  });

  await handleDirtyPaths();
}
