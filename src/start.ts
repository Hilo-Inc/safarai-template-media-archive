// Process entry (bundled to dist/start.mjs): check settings, then start the Astro server.
import { ConfigError, loadConfig } from './config/load';
import { EnvError, getEnv } from './env';

try {
  loadConfig();
  getEnv();
} catch (error) {
  if (error instanceof ConfigError || error instanceof EnvError) {
    console.error(`Cannot start: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

// A variable keeps esbuild from bundling Astro's server; it is loaded from dist/server at run time.
const entry = './server/entry.mjs';
await import(entry);
