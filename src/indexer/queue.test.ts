import { describe, expect, it } from 'vitest';
import { ImportQueue } from './queue';
import type { ImportStatus } from './status';

const status = (id: string, state: ImportStatus['state'], createdAt: string) => ({ id, state, createdAt }) as ImportStatus;

function harness(statuses: ImportStatus[] = []) {
  const log: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const queue = new ImportQueue({
    run: async (id) => {
      log.push(`start ${id}`);
      if (id === 'slow') await gate;
      log.push(`end ${id}`);
    },
    build: async () => void log.push('build'),
    statuses: async () => statuses,
  });
  return { queue, log, release };
}

describe('ImportQueue', () => {
  it('runs one import at a time, in order, and ignores duplicates', async () => {
    const { queue, log, release } = harness();
    queue.enqueue('slow');
    queue.enqueue('b');
    queue.enqueue('b');
    await Promise.resolve();
    expect(queue.current()).toBe('slow');
    release();
    await queue.idle();
    expect(log).toEqual(['start slow', 'end slow', 'start b', 'end b']);
    expect(queue.current()).toBeNull();
  });

  it('coalesces rebuild requests made while busy', async () => {
    const { queue, log, release } = harness();
    queue.enqueue('slow');
    const a = queue.requestRebuild();
    const b = queue.requestRebuild();
    expect(a).toBe(b);
    release();
    await a;
    expect(log.filter((l) => l === 'build')).toHaveLength(1);
  });

  it('keeps going after a failure', async () => {
    const queue = new ImportQueue({
      run: async (id) => {
        if (id === 'bad') throw new Error('boom');
      },
      build: async () => {},
      statuses: async () => [],
    });
    queue.enqueue('bad');
    await queue.idle();
    await expect(queue.requestRebuild()).resolves.toBeUndefined();
  });

  it('resumes running and queued imports, oldest first', async () => {
    const { queue, log } = harness([
      status('new', 'queued', '2026-10-10T02:00:00.000Z'),
      status('done', 'done', '2026-10-10T00:00:00.000Z'),
      status('old', 'running', '2026-10-10T01:00:00.000Z'),
      status('up', 'uploading', '2026-10-10T00:30:00.000Z'),
    ]);
    await queue.resume();
    await queue.idle();
    expect(log).toEqual(['start old', 'end old', 'start new', 'end new']);
  });
});
