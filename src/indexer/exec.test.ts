import { describe, expect, it } from 'vitest';
import { run } from './exec';

const fail = (cmd: string, args: string[]) => run(cmd, args).then(() => new Error('did not fail'), (e: Error) => e);

describe('run', () => {
  it('reports the failing tool and last stderr line without host paths', async () => {
    const err = await fail('node', ['-e', 'process.stderr.write("cannot open " + process.argv[1]); process.exit(2)', '/secret/dir/file.jpg']);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('node could not process this file');
    expect(err.message).toContain('file.jpg');
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('/secret');
  });

  it('strips Windows-style directories too', async () => {
    const err = await fail('node', ['-e', 'process.stderr.write("bad " + process.argv[1]); process.exit(2)', String.raw`C:\Users\owner\a.png`]);
    expect(err.message).toContain('a.png');
    expect(err.message).not.toContain('owner');
  });

  it('uses fixed text, not the raw error message, when the tool says nothing', async () => {
    const err = await fail('node', ['-e', 'process.exit(3)', '/secret/dir/x']);
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('Command failed');
    const missing = await fail('definitely-not-a-tool-xyz', ['/secret/x']);
    expect(missing.message).toBe('definitely-not-a-tool-xyz is not available on the server');
  });
});
