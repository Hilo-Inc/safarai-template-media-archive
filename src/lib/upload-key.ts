import { isNormalPath } from '../indexer/import-files';
import { isDeniedPath } from '../importers/guard';
import { keys } from './keys';

export const MAX_PATH_LENGTH = 900;

/** Why a relative import path is unacceptable, or null when it is fine. */
export function importPathProblem(path: string): string | null {
  // isNormalPath: relative, forward slashes, no empty/./.. segments, no control characters.
  if (path.length > MAX_PATH_LENGTH || !isNormalPath(path)) return 'Bad file path';
  if (isDeniedPath(path)) return 'This folder is never uploaded';
  return null;
}

/** The only bucket keys a browser may upload to: `imports/<importId>/<path>` with a clean path. */
export function parseUploadKey(key: string, importId: string): { ok: true; path: string } | { ok: false; reason: string } {
  const prefix = keys.importPrefix(importId);
  if (!key.startsWith(prefix)) return { ok: false, reason: 'Not part of this import' };
  const path = key.slice(prefix.length);
  const problem = importPathProblem(path);
  return problem ? { ok: false, reason: problem } : { ok: true, path };
}
