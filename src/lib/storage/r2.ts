// Cloudflare R2 implementation of the storage provider, via aws4fetch
// (SigV4 signing in ~6KB with zero dependencies; the full AWS SDK would be
// a Principle-5 violation for what amounts to one signed URL shape).
import { AwsClient } from "aws4fetch";
import type { PresignedUpload, StorageProvider } from "./types";

const UPLOAD_URL_TTL_SECONDS = 900;

export type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
  publicBaseUrl: string; // CDN base (custom domain or r2.dev)
};

export class R2Provider implements StorageProvider {
  private client: AwsClient;

  constructor(private config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  private objectUrl(key: string): URL {
    const base = this.config.endpoint.replace(/\/+$/, "");
    // Encode each path segment; slashes between segments are real.
    const path = key.split("/").map(encodeURIComponent).join("/");
    return new URL(`${base}/${this.config.bucket}/${path}`);
  }

  async presignUpload(
    key: string,
    contentType: string
  ): Promise<PresignedUpload> {
    const url = this.objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_SECONDS));
    const signed = await this.client.sign(
      new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }),
      { aws: { signQuery: true } }
    );
    return { uploadUrl: signed.url, publicUrl: this.publicUrl(key) };
  }

  publicUrl(key: string): string {
    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `${base}/${path}`;
  }

  async deleteObject(key: string): Promise<void> {
    const signed = await this.client.sign(
      new Request(this.objectUrl(key), { method: "DELETE" })
    );
    const res = await fetch(signed);
    // 404 is fine: deleting an already-gone object is success for callers.
    if (!res.ok && res.status !== 404) {
      throw new Error(`R2 delete failed: ${res.status}`);
    }
  }
}
