import { describe, expect, it } from 'vitest';
import { fixMetaText } from './meta-text';

/** How Meta writes UTF-8: each byte as its own \u00XX code unit. */
const moji = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

describe('fixMetaText', () => {
  it('repairs Latin-1-escaped UTF-8 (emoji and accents)', () => {
    expect(fixMetaText(moji('Café 🌊'))).toBe('Café 🌊');
    expect(fixMetaText('CafÃ©')).toBe('Café');
  });

  it('leaves plain ASCII and already-correct text alone', () => {
    expect(fixMetaText('Hello #tag')).toBe('Hello #tag');
    expect(fixMetaText('Café 🌊')).toBe('Café 🌊');
  });

  it('leaves Latin-1 text that is not valid UTF-8 unchanged', () => {
    expect(fixMetaText('Café')).toBe('Café');
    expect(fixMetaText('ÿþ')).toBe('ÿþ');
  });
});
