import { describe, expect, it } from 'vitest';
import { signJsonPaths, urlSigner } from './media-url';

const presign = async (key: string) => `https://signed.example/${key}?X-Amz-Signature=abc`;

describe('urlSigner', () => {
  it('uses the public base when there is one', async () => {
    const sign = urlSigner('https://media.example.com', presign);
    expect(await sign('media/a b/0/orig.jpg')).toBe('https://media.example.com/media/a%20b/0/orig.jpg');
  });

  it('presigns without a public base', async () => {
    expect(await urlSigner(null, presign)('media/a/0/orig.jpg')).toBe('https://signed.example/media/a/0/orig.jpg?X-Amz-Signature=abc');
  });
});

describe('signJsonPaths', () => {
  it('rewrites every src and peaks string, deeply, and nothing else', async () => {
    const sign = urlSigner('https://m.example', presign);
    const out = await signJsonPaths(
      {
        id: 'files_a',
        caption: 'src',
        media: [
          { type: 'image', src: 'media/a/0/orig.jpg', variants: [{ w: 320, src: 'media/a/0/w320.webp' }] },
          { type: 'audio', src: 'media/a/1/orig.mp3', peaks: 'media/a/1/peaks.json' },
          { type: 'video', src: 'media/a/2/orig.mp4', poster: null },
        ],
      },
      sign,
    );
    expect(out).toEqual({
      id: 'files_a',
      caption: 'src',
      media: [
        { type: 'image', src: 'https://m.example/media/a/0/orig.jpg', variants: [{ w: 320, src: 'https://m.example/media/a/0/w320.webp' }] },
        { type: 'audio', src: 'https://m.example/media/a/1/orig.mp3', peaks: 'https://m.example/media/a/1/peaks.json' },
        { type: 'video', src: 'https://m.example/media/a/2/orig.mp4', poster: null },
      ],
    });
  });
});
