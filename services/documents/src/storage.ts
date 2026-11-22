import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { DocumentsConfig } from './env';

/**
 * S3-compatible storage. Locally it is s3rver, in production MinIO or S3.
 * The service only needs put/head/create, so the small AWS SDK surface keeps
 * vendor lock-in low.
 */
export class DocumentStorage {
  private readonly client: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly config: DocumentsConfig) {
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `${config.S3_USE_SSL ? 'https' : 'http'}://${config.S3_ENDPOINT}:${config.S3_PORT}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    });
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
        } catch {
          await this.client.send(new CreateBucketCommand({ Bucket: this.config.S3_BUCKET }));
        }
      })().catch((error) => {
        this.bucketReady = null;
        throw error;
      });
    }
    return this.bucketReady;
  }

  async put(key: string, pdf: Uint8Array): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: Buffer.from(pdf),
        ContentType: 'application/pdf',
        CacheControl: 'private, max-age=60',
      }),
    );
  }

  async healthy(): Promise<boolean> {
    try {
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }
}
