import { getPackagesToSync } from './detectors.js';
import { syncFile } from './syncFile.js';

/**
 * @param {string} dir the current working directory or the directory of a project
 */
export async function sync(dir) {
  const packageToSync = await getPackagesToSync(dir);

  await Promise.all(
    Object.entries(packageToSync.filesToSync).flatMap(
      async ([syncFrom, syncToPaths]) =>
        syncToPaths.map((syncTo) => syncFile(syncFrom, syncTo))
    )
  );
}
