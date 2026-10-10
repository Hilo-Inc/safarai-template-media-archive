import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/load';
import { getEnv } from '../env';
import { shared } from '../lib/shared';
import { store } from '../lib/store';
import { buildIndex } from './build-index';
import { runImport } from './run-import';
import { listStatuses, type ImportStatus } from './status';

export interface QueueDeps {
  run(id: string): Promise<unknown>;
  build(): Promise<unknown>;
  statuses(): Promise<ImportStatus[]>;
}

/** One import or index rebuild at a time, in the order requested. */
export class ImportQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly waiting = new Set<string>();
  private running: string | null = null;
  private pendingRebuild: Promise<void> | null = null;

  constructor(private readonly deps: QueueDeps) {}

  private schedule(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task);
    this.tail = run.catch((error: unknown) => console.error(`Queue task failed: ${error instanceof Error ? error.message : 'unknown error'}`));
    return run;
  }

  enqueue(id: string): void {
    if (this.waiting.has(id) || this.running === id) return;
    this.waiting.add(id);
    void this.schedule(async () => {
      this.waiting.delete(id);
      this.running = id;
      try {
        await this.deps.run(id);
      } finally {
        this.running = null;
      }
    }).catch(() => undefined);
  }

  /** Rebuilds the index after whatever is queued; requests made before it starts share one rebuild. */
  requestRebuild(): Promise<void> {
    if (!this.pendingRebuild) {
      this.pendingRebuild = this.schedule(async () => {
        this.pendingRebuild = null;
        await this.deps.build();
      });
    }
    return this.pendingRebuild;
  }

  /** On start: imports left running or queued by a restart continue, oldest first. */
  async resume(): Promise<void> {
    const open = (await this.deps.statuses()).filter((s) => s.state === 'running' || s.state === 'queued');
    open.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const s of open) this.enqueue(s.id);
  }

  async idle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }

  current(): string | null {
    return this.running;
  }
}

/** The production index build: feeds use SITE_URL / COOLIFY_URL, else the last admin origin. */
export async function rebuild(): Promise<unknown> {
  const s = store();
  const env = getEnv();
  return buildIndex(s, loadConfig(), { siteUrl: env.siteUrl, mediaPublicUrl: env.mediaPublicUrl });
}

export function getQueue(): ImportQueue {
  return shared(
    'queue',
    () =>
      new ImportQueue({
        run: (id) =>
          runImport(id, {
            store: store(),
            config: loadConfig(),
            workRoot: process.env.WORK_DIR || join(tmpdir(), 'media-archive'),
            build: rebuild,
          }),
        build: rebuild,
        statuses: () => listStatuses(store()),
      }),
  );
}
