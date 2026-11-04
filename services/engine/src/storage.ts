/**
 * FILE: services/engine/src/storage.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Object storage for raw captures (HTML/JSON) and documents (PDFs). Two drivers behind one
 *   interface: "fs" (a folder on disk — laptops, VMs with a mounted disk) and "s3" (any S3-compatible
 *   service: Cloudflare R2, Hetzner, MinIO in docker-compose, AWS). Files are content-addressed:
 *   the key contains the sha256 of the bytes, so the same file is never stored twice.
 * WHERE IT RUNS: engine workers.
 * TYPESCRIPT YOU WILL SEE HERE: `interface`, classes implementing an interface, `node:crypto`.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EngineConfig } from "./config";

/** Kind: function. Hex sha256 of some bytes. */
export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/**
 * Kind: function. The content-addressed key for a blob, e.g. "raw/cssf/ab/abcdef….json".
 * @param area  type `string` — top folder ("raw/cssf", "docs", "text").
 * @param hash  type `string` — sha256 of the bytes.
 * @param ext   type `string` — file extension without dot.
 */
export const blobKey = (area: string, hash: string, ext: string) => `${area}/${hash.slice(0, 2)}/${hash}.${ext}`;

/** Kind: interface. What every storage driver offers. */
export interface BlobStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
}

/** Kind: class. Stores blobs as files under a root folder. */
export class FsBlobStore implements BlobStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  async put(key: string, body: Buffer) {
    const path = join(this.root, key);
    if (await this.exists(key)) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  async get(key: string) {
    try {
      return await readFile(join(this.root, key));
    } catch {
      return null;
    }
  }
  async exists(key: string) {
    try {
      await stat(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }
}

/** Kind: class. Stores blobs in an S3-compatible bucket. */
export class S3BlobStore implements BlobStore {
  private client: S3Client;
  constructor(
    private cfg: Extract<EngineConfig["storage"], { driver: "s3" }>,
  ) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    if (await this.exists(key)) return;
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    } catch {
      return null;
    }
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Kind: function. Builds the configured driver.
 * @param cfg  type `EngineConfig["storage"]`.
 * @returns `BlobStore`.
 */
export function makeBlobStore(cfg: EngineConfig["storage"]): BlobStore {
  return cfg.driver === "s3" ? new S3BlobStore(cfg) : new FsBlobStore(cfg.root);
}
