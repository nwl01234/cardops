import { Client } from 'minio';
import type { DocumentsConfig } from './env';

export class DocumentStorage {
  private readonly client: Client;
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly config: DocumentsConfig) {
    this.client = new Client({
      endPoint: config.S3_ENDPOINT,
      port: config.S3_PORT,
      useSSL: config.S3_USE_SSL,
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
    });
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const exists = await this.client.bucketExists(this.config.S3_BUCKET);
        if (!exists) await this.client.makeBucket(this.config.S3_BUCKET);
      })().catch((error) => {
        this.bucketReady = null;
        throw error;
      });
    }
    return this.bucketReady;
  }

  async put(key: string, pdf: Uint8Array): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(this.config.S3_BUCKET, key, Buffer.from(pdf), pdf.length, {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, max-age=60',
    });
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
