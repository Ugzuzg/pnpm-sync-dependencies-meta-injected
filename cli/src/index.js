import Debug from 'debug';

import { sync } from './sync.js';
import { watchMode } from './watchMode.js';

const debug = Debug('sync-pnpm');

/**
 * @typedef {object} Options
 * @property {string} directory working directory
 * @property {boolean} watch enable or disable watch mode
 *
 * @param {Options} options
 */
export default async function syncPnpm(options) {
  const { directory: dir, watch } = options;

  debug(`Detected arguments:`);
  debug(`--watch=${watch}`);
  debug(`--directory=${dir}`);

  if (!watch) {
    await sync(dir);

    return;
  }

  await watchMode(dir);
}
