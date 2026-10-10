/**
 * A process-wide singleton. The start entry (dist/start.mjs) and the Astro server bundle
 * each carry their own copy of our modules, so module-level state would exist twice;
 * keeping it on globalThis under a registered symbol gives both copies one instance.
 */
export function shared<T>(name: string, create: () => T): T {
  const key = Symbol.for(`media-archive.${name}`);
  const g = globalThis as Record<symbol, unknown>;
  if (!(key in g)) g[key] = create();
  return g[key] as T;
}
