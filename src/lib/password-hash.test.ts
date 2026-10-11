import { describe, expect, it } from 'vitest';
import { parsePasswordHash, verifyPassword, verifyPasswordSync } from './password-hash';

// The same vectors are in Safarai's packages/shared/src/password-hash.test.ts.
const SALT = 'AAECAwQFBgcICQoLDA0ODw';
const ASCII = { password: 'correct horse battery staple', hash: `pbkdf2-sha256$600000$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY` };
const UNICODE = {
  nfc: 'pässwörd \u{1F511} lång',
  nfd: 'pässwörd \u{1F511} lång',
  hash: `pbkdf2-sha256$600000$${SALT}$uItD2LEIk3VCFQeA8KteV8qxESPX_gqQ1ASzK1ilxF8`,
};

describe('parsePasswordHash', () => {
  it('reads the iterations, salt and key', () => {
    const parsed = parsePasswordHash(ASCII.hash)!;
    expect(parsed.iterations).toBe(600000);
    expect(parsed.salt).toEqual(Buffer.from([...Array(16).keys()]));
    expect(parsed.key).toHaveLength(32);
  });

  it.each([
    ['a plain password', 'correct horse battery staple'],
    ['another algorithm', `scrypt$600000$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`],
    ['too few iterations', `pbkdf2-sha256$99999$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`],
    ['too many iterations', `pbkdf2-sha256$10000001$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`],
    ['a short salt', 'pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0O$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY'],
    ['a short hash', `pbkdf2-sha256$600000$${SALT}$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYwe`],
    ['padding', `pbkdf2-sha256$600000$${SALT}==$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`],
    ['a non-canonical last character', `pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODx$7xdxRO7JQgy8EJPSqLNEqSvFBtDU7JwCjdGfgyTYweY`],
  ])('rejects %s', (_, value) => {
    expect(parsePasswordHash(value)).toBeNull();
  });
});

describe('verifyPassword', () => {
  it('accepts the password of the shared vector', async () => {
    expect(await verifyPassword(ASCII.password, parsePasswordHash(ASCII.hash)!)).toBe(true);
    expect(verifyPasswordSync(ASCII.password, parsePasswordHash(ASCII.hash)!)).toBe(true);
  });

  it('rejects a one-character change', async () => {
    expect(await verifyPassword('correct horse battery stapler', parsePasswordHash(ASCII.hash)!)).toBe(false);
    expect(verifyPasswordSync('Correct horse battery staple', parsePasswordHash(ASCII.hash)!)).toBe(false);
  });

  it('accepts a non-ASCII password typed composed or decomposed', async () => {
    const hash = parsePasswordHash(UNICODE.hash)!;
    expect(await verifyPassword(UNICODE.nfc, hash)).toBe(true);
    expect(await verifyPassword(UNICODE.nfd, hash)).toBe(true);
  });
});
