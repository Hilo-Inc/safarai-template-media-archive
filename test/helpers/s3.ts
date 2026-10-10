import { S3Client } from '@aws-sdk/client-s3';

/** The S3 test server from docker-compose.yml. */
export function testS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

/** A fresh key prefix per test so tests sharing the bucket never see each other's objects. */
export function testPrefix(name: string): string {
  return `t-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}/`;
}
