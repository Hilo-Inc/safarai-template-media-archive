import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { testPrefix, testS3Client } from '../helpers/s3';

describe('S3 test server', () => {
  it('stores and returns an object', async () => {
    const s3 = testS3Client();
    const Key = `${testPrefix('smoke')}hello.txt`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key, Body: 'hi' }));
    const got = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key }));
    expect(await got.Body!.transformToString()).toBe('hi');
  });
});
