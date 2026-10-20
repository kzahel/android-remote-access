// Temporary compatibility entry point for demos started before the spike move.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export { createDemo } from './spike/server.mjs';
import { main } from './spike/server.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
