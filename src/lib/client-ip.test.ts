import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('prefers Cloudflare, then the first forwarded address, then the socket', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), '3.3.3.3')).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 2.2.2.2 , 10.0.0.1' }), '3.3.3.3')).toBe('2.2.2.2');
    expect(clientIp(new Headers(), '3.3.3.3')).toBe('3.3.3.3');
    expect(clientIp(new Headers(), undefined)).toBe('unknown');
  });
});
