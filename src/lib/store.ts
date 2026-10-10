import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ServerEnv } from '../env';
import { getEnv } from '../env';
import { CACHE_JSON, CACHE_MEDIA } from './keys';
import { shared } from './shared';

export type StoreOptions = ServerEnv['s3'] & { root?: string };
export interface StoredObject { key: string; size: number; lastModified: Date }
export interface UploadRequest {
  op: 'put' | 'create' | 'part' | 'complete' | 'abort' | 'listParts' | 'delete';
  key: string;
  uploadId?: string;
  partNumber?: number;
}

const UPLOAD_URL_SECONDS = 3600;

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** The bucket. Every key is relative to `root` (empty in production; a per-test prefix in tests). */
export class Store {
  readonly bucket: string;
  private readonly root: string;
  private readonly client: S3Client;

  constructor(opts: StoreOptions, client?: S3Client) {
    this.bucket = opts.bucket;
    this.root = opts.root ?? '';
    this.client =
      client ??
      new S3Client({
        endpoint: opts.endpoint,
        region: opts.region,
        forcePathStyle: opts.forcePathStyle,
        credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
        // R2 rejects the SDK's default CRC32 checksums on presigned and multipart requests.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }

  private k(key: string): string {
    return this.root + key;
  }

  async getText(key: string): Promise<string | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return await out.Body!.transformToString('utf-8');
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const text = await this.getText(key);
    return text === null ? null : (JSON.parse(text) as T);
  }

  async getStream(key: string): Promise<{ body: ReadableStream; contentType: string | null; length: number | null } | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return { body: out.Body!.transformToWebStream(), contentType: out.ContentType ?? null, length: out.ContentLength ?? null };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return true;
    } catch (error) {
      if (statusOf(error) === 404) return false;
      throw error;
    }
  }

  async put(key: string, body: string | Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: body, ContentType: contentType, CacheControl: cacheControl }),
    );
  }

  async putJson(key: string, value: unknown, cacheControl = CACHE_JSON): Promise<void> {
    await this.put(key, JSON.stringify(value), 'application/json', cacheControl);
  }

  async putFile(key: string, file: string, contentType: string, cacheControl = CACHE_MEDIA): Promise<void> {
    const { size } = await stat(file);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.k(key),
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async download(key: string, file: string): Promise<void> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
    await pipeline(out.Body as Readable, createWriteStream(file));
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.k(prefix), ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) {
        out.push({ key: o.Key!.slice(this.root.length), size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteKeys(list: string[]): Promise<void> {
    for (let i = 0; i < list.length; i += 1000) {
      const batch = list.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((key) => ({ Key: this.k(key) })), Quiet: true } }),
      );
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const found = await this.list(prefix);
    await this.deleteKeys(found.map((o) => o.key));
    return found.length;
  }

  presignGet(key: string, seconds = 3600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }), { expiresIn: seconds });
  }

  /** A URL the browser uses for one step of a direct upload. Callers check the key first. */
  presignUpload(req: UploadRequest): Promise<string> {
    const Bucket = this.bucket;
    const Key = this.k(req.key);
    const UploadId = req.uploadId;
    const command = {
      put: () => new PutObjectCommand({ Bucket, Key }),
      create: () => new CreateMultipartUploadCommand({ Bucket, Key }),
      part: () => new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: req.partNumber }),
      complete: () => new CompleteMultipartUploadCommand({ Bucket, Key, UploadId }),
      abort: () => new AbortMultipartUploadCommand({ Bucket, Key, UploadId }),
      listParts: () => new ListPartsCommand({ Bucket, Key, UploadId }),
      delete: () => new DeleteObjectCommand({ Bucket, Key }),
    }[req.op]();
    // getSignedUrl is generic over one command type; the union of seven commands does not infer, so any one stands in.
    return getSignedUrl(this.client, command as PutObjectCommand, { expiresIn: UPLOAD_URL_SECONDS });
  }

  /** Aborts unfinished multipart uploads under a prefix, so their parts stop costing storage. */
  async abortUploads(prefix: string): Promise<number> {
    let count = 0;
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const page = await this.client.send(
        new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: this.k(prefix), KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }),
      );
      for (const u of page.Uploads ?? []) {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: u.Key, UploadId: u.UploadId }));
        count++;
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
    return count;
  }
}

export function store(): Store {
  return shared('store', () => new Store(getEnv().s3));
}
