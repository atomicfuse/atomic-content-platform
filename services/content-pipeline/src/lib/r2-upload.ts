import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

let s3Client: S3Client | null = null;
let cachedConfig: R2Config | null = null;

function getS3Client(config: R2Config): S3Client {
  if (
    s3Client &&
    cachedConfig &&
    cachedConfig.accountId === config.accountId &&
    cachedConfig.accessKeyId === config.accessKeyId
  ) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedConfig = config;
  return s3Client;
}

export function buildR2Key(
  siteId: string,
  slug: string,
  extension: string
): string {
  return `${siteId}/assets/images/${slug}.${extension}`;
}

export async function uploadImageToR2(
  config: R2Config,
  siteId: string,
  slug: string,
  imageBuffer: Buffer,
  contentType: string
): Promise<string> {
  const client = getS3Client(config);
  const extension = contentType.split("/")[1] ?? "webp";
  const key = buildR2Key(siteId, slug, extension);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
    })
  );

  return `/assets/images/${slug}.${extension}`;
}
