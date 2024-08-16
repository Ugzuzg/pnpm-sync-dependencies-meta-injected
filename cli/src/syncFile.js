import fs from 'node:fs/promises';
import { dirname } from 'node:path';

import Debug from 'debug';
import lockfile from 'proper-lockfile';

const debug = Debug('sync-pnpm');

/**
 * @param {string} syncFrom
 * @param {string} syncTo
 */
export async function syncFile(syncFrom, syncTo) {
  // NOTE: that there is an oddity with this code:
  //   in some situations,
  //   we can't remove because it ends up removing the source files
  //   (like if the syncTo === syncFrom -- which happens if
  //    depMeta.*.injected has failed, and we resolve the original output
  if (syncTo === syncFrom) {
    throw new Error('this should never happen, but it did. Report a bug');
  }

  await fs.mkdir(dirname(syncTo), { recursive: true });

  let releaseLock;

  try {
    try {
      releaseLock = await lockfile.lock(syncTo, { realpath: false });
      debug(`lockfile created for syncing to ${syncTo}`);
    } catch (e) {
      debug(
        `lockfile already exists for syncing to ${syncTo}, some other sync process is already handling this directory, so skipping...`
      );

      return;
    }

    await fs.rm(syncTo, { force: true });

    debug(`syncing from ${syncFrom} to ${syncTo}`);
    await fs.link(syncFrom, syncTo);
  } finally {
    await releaseLock?.();
  }
}
