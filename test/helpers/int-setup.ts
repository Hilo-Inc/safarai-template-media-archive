import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { testS3Client } from './s3';

export default async function setup() {
  const s3 = testS3Client();
  const Bucket = process.env.S3_BUCKET!;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
      return;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) {
        await s3.send(new CreateBucketCommand({ Bucket }));
        return;
      }
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
