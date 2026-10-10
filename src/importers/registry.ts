import { genericImporter } from './generic';
import { isMetaExport, META_REFUSAL } from './guard';
import type { Importer, Listing } from './types';

/** Most specific first; `generic` accepts anything and stays last. */
export const IMPORTERS: readonly Importer[] = [genericImporter];

export function getImporter(name: string): Importer | null {
  return IMPORTERS.find((i) => i.name === name) ?? null;
}

export function chooseImporter(listing: Listing): { ok: true; importer: Importer } | { ok: false; reason: string } {
  if (isMetaExport(listing.entries.map((e) => e.path))) return { ok: false, reason: META_REFUSAL };
  return { ok: true, importer: IMPORTERS.find((i) => i.detect(listing))! };
}
