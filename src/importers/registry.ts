import { genericImporter } from './generic';
import { INSTAGRAM_HTML_REFUSAL, isMetaExport, META_REFUSAL, metaExportKind } from './guard';
import { instagramImporter } from './instagram';
import type { Importer, Listing } from './types';

/** Most specific first; `generic` accepts anything and stays last. */
export const IMPORTERS: readonly Importer[] = [instagramImporter, genericImporter];

export function getImporter(name: string): Importer | null {
  return IMPORTERS.find((i) => i.name === name) ?? null;
}

export function chooseImporter(listing: Listing): { ok: true; importer: Importer } | { ok: false; reason: string } {
  const paths = listing.entries.map((e) => e.path);
  const kind = metaExportKind(paths);
  if (kind === 'instagram-html') return { ok: false, reason: INSTAGRAM_HTML_REFUSAL };
  // Facebook, and any other Meta export that isn't Instagram JSON.
  if (kind === 'facebook' || (kind === null && isMetaExport(paths))) return { ok: false, reason: META_REFUSAL };
  return { ok: true, importer: IMPORTERS.find((i) => i.detect(listing))! };
}
