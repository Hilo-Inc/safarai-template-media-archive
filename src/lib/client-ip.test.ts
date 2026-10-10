import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('uses the forwarded address, then the socket', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 2.2.2.2 ' }), '3.3.3.3')).toBe('2.2.2.2');
    expect(clientIp(new Headers(), '3.3.3.3')).toBe('3.3.3.3');
    expect(clientIp(new Headers(), undefined)).toBe('unknown');
  });
});

describe('clientIp trust', () => {
  it('uses the right-most forwarded entry and ignores a forged first one', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 5.5.5.5, 4.4.4.4' }), '3.3.3.3')).toBe('4.4.4.4');
    expect(clientIp(new Headers({ 'x-forwarded-for': '7.7.7.7, 4.4.4.4' }), '3.3.3.3')).toBe(
      clientIp(new Headers({ 'x-forwarded-for': '8.8.8.8, 4.4.4.4' }), '3.3.3.3'),
    );
    expect(clientIp(new Headers({ 'x-forwarded-for': '4.4.4.4, ' }), '3.3.3.3')).toBe('4.4.4.4');
  });
  it('ignores cf-connecting-ip', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1' }), '3.3.3.3')).toBe('3.3.3.3');
  });
});
