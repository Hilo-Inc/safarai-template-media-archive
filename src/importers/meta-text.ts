/**
 * Meta's exports write UTF-8 text as one \u00XX code unit per byte ("CafÃ©" for "Café"). When every code unit fits in
 * a byte, decode them as UTF-8; text that is already correct, or is not valid UTF-8, comes back unchanged.
 */
export function fixMetaText(text: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) return text;
    bytes[i] = c;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}
