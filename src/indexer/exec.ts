import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MediaError } from './errors';

const execFileP = promisify(execFile);

export async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    const last = stderr.split('\n').at(-1)?.slice(0, 200) || (error as Error).message.slice(0, 200);
    throw new MediaError(`${cmd} could not process this file: ${last}`);
  }
}
