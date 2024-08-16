import { getPackagesToSync } from './detectors.js';
import { syncFile } from './syncFile.js';

/**
 * @param {string} dir the current working directory or the directory of a project
 */
export async function sync(dir) {
  const packagesToSync = await getPackagesToSync(dir);

  await Promise.all(
    packagesToSync.flatMap(async ({ filesToSync }) =>
      Object.entries(filesToSync).map(async ([syncFrom, syncTo]) =>
        syncFile(syncFrom, syncTo)
      )
    )
  );
}
