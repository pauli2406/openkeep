import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { pipeline } from "stream/promises";

import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class ObjectStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {
    this.bucket = configService.get("MINIO_BUCKET");
    this.client = new S3Client({
      endpoint: `${configService.get("MINIO_USE_SSL") ? "https" : "http"}://${configService.get("MINIO_ENDPOINT")}:${configService.get("MINIO_PORT")}`,
      forcePathStyle: true,
      region: "auto",
      credentials: {
        accessKeyId: configService.get("MINIO_ACCESS_KEY"),
        secretAccessKey: configService.get("MINIO_SECRET_KEY"),
      },
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.configService.get("SKIP_EXTERNAL_INIT")) {
      return;
    }

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return key;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getObjectStream(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return result.Body;
  }

  async downloadToTempFile(key: string): Promise<string> {
    const stream = await this.getObjectStream(key);
    const tempDir = await mkdtemp(join(tmpdir(), "openkeep-"));
    const target = join(tempDir, basename(key) || `${randomUUID()}.bin`);

    if (!stream) {
      throw new Error(`Missing object stream for ${key}`);
    }

    await pipeline(stream as NodeJS.ReadableStream, createWriteStream(target));
    return target;
  }

  async ensureReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async removeTempFile(filePath: string): Promise<void> {
    await rm(filePath, { recursive: true, force: true }).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.destroy();
  }
}
