import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DIMENSION = 1024;
const MAX_BYTES = 10 * 1024 * 1024;

function assertImageId(id: string): void {
  if (!IMAGE_ID.test(id)) throw new AppError("Image not found", 404);
}

export class Images {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    operationKey?: string,
  ): Promise<Artifact> {
    const id = operationKey === undefined ? randomUUID() : deterministicImageId(owner, operationKey);
    if (operationKey !== undefined) {
      const existing = await this.db.get<Artifact>(owner, "images", id);
      if (existing) return this.signed(owner, existing);
    }
    if (bytes.length > MAX_BYTES) throw new AppError("Image must be 10 MB or smaller", 413);
    const resized = await this.resize(bytes);
    const directory = join(this.config.dataDir, "images");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = this.pathFor(id);
    await writeFile(path, resized, { mode: 0o600, flag: "wx" });
    const metadata = await sharp(resized).metadata();
    const artifact: Artifact = {
      id,
      name: sanitizeImageName(name),
      mimeType: "image/png",
      size: resized.length,
      width: metadata.width,
      height: metadata.height,
      url: "",
      createdAt: new Date().toISOString(),
      source,
    };
    await this.db.put(owner, "images", artifact);
    return this.signed(owner, artifact);
  }
  async importFromUrl(owner: string, url: string, source: string): Promise<Artifact> {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "OpenFuse/1.0 (https://openmuse.app; contact@openmuse.app)" },
    });
    if (!response.ok) throw new AppError(`Failed to fetch image: ${response.status}`, 422);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new AppError("URL does not point to an image", 422);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const name = url.split(/[/?#]/).at(-1) ?? "image.png";
    return this.import(owner, name, bytes, source);
  }
  signed(owner: string, image: Artifact): Artifact {
    return { ...image, url: this.auth.sign(owner, `/api/images/${image.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "images")).map((image) => this.signed(owner, image));
  }
  async get(owner: string, id: string) {
    assertImageId(id);
    const image = await this.db.get<Artifact>(owner, "images", id);
    if (!image) throw new AppError("Image not found", 404);
    return image;
  }
  private pathFor(id: string): string {
    assertImageId(id);
    const directory = resolve(this.config.dataDir, "images");
    const resolved = resolve(directory, `${id}.png`);
    if (!resolved.startsWith(`${directory}${sep}`)) throw new AppError("Image not found", 404);
    return resolved;
  }
  async bytes(owner: string, id: string) {
    await this.get(owner, id);
    return readFile(this.pathFor(id));
  }
  private async resize(bytes: Uint8Array): Promise<Uint8Array> {
    return sharp(bytes)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
  }
}

function deterministicImageId(owner: string, operationKey: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify([owner, operationKey]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sanitizeImageName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "image.png";
  const cleaned = Array.from(base)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .slice(0, 180)
    .join("");
  return cleaned || "image.png";
}
