import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { MediaError } from './errors';

const execFileP = promisify(execFile);

/** Replaces every path-like argument in a tool's message with its file name, so host directories never reach the owner. */
function redact(text: string, args: string[]): string {
  let out = text;
  for (const arg of args) {
    if (!/[/\\]/.test(arg)) continue;
    const name = arg.split(/[/\\]/).filter(Boolean).at(-1) ?? '';
    out = out.split(arg).join(name);
  }
  return out;
}

export async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const tool = basename(cmd);
  try {
    return await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  } catch (error) {
    const e = error as { stderr?: unknown; code?: unknown; killed?: boolean; signal?: unknown };
    if (e.code === 'ENOENT') throw new MediaError(`${tool} is not available on the server`);
    const stderr = String(e.stderr ?? '').trim();
    const last = redact(stderr.split('\n').at(-1) ?? '', args).slice(0, 200);
    if (last) throw new MediaError(`${tool} could not process this file: ${last}`);
    if (e.killed || e.signal) throw new MediaError(`${tool} was killed or timed out`);
    throw new MediaError(`${tool} could not process this file`);
  }
}
