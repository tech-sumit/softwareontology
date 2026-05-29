import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { ObjectStore, Config } from '@so/sdk';

export interface ObjectStoreService extends ObjectStore {
  client: S3Client;
  bucket: string;
  ping(): Promise<void>;
}

export function createObjectStore(config: Config): ObjectStoreService {
  const bucket = config.require('S3_BUCKET');
  const useSsl = config.get('S3_USE_SSL') === 'true';
  const client = new S3Client({
    endpoint: `${useSsl ? 'https' : 'http'}://${config.require('S3_ENDPOINT')}`,
    region: config.get('S3_REGION') ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.require('S3_ACCESS_KEY_ID'),
      secretAccessKey: config.require('S3_SECRET_ACCESS_KEY'),
    },
  });
  return {
    client,
    bucket,
    async putObject(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    getObjectUrl(key) { return `s3://${bucket}/${key}`; },
    async ping() { await client.send(new HeadBucketCommand({ Bucket: bucket })); },
  };
}
