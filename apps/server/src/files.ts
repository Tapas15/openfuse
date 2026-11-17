import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "document";
  const cleaned = Array.from(base)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .slice(0, 180)
    .join("");
  return cleaned || "document";
}

function assertFileId(id: string): void {
  if (!FILE_ID.test(id)) throw new AppError("File not found", 404);
}

export function deterministicFileId(owner: string, operationKey: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify([owner, operationKey]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

function extFor(mimeType: string, name: string): string {
  const fromName = extname(name).toLowerCase();
  if (fromName) return fromName;
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/bmp") return ".bmp";
  if (mimeType === "text/plain") return ".txt";
  if (mimeType === "application/msword") return ".doc";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (mimeType === "application/vnd.ms-powerpoint") return ".ppt";
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return ".pptx";
  return "";
}

export class Files {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    mimeType: string,
    source: string,
    parentId?: string,
    operationKey?: string,
  ): Promise<Artifact> {
    const id = operationKey === undefined ? randomUUID() : deterministicFileId(owner, operationKey);
    if (operationKey !== undefined) {
      const existing = await this.db.get<Artifact>(owner, "files", id);
      if (existing) return this.signed(owner, existing);
    }
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("Files must be 10 MB or smaller", 413);
    const safeMime = ALLOWED_MIMES.has(mimeType) ? mimeType : "application/octet-stream";
    let pageCount = 0;
    let fields: Artifact["fields"] = [];
    if (safeMime === "application/pdf") {
      const metadata = await inspectPdf(bytes);
      if (metadata.pageCount > 500) throw new AppError("PDFs must have 500 pages or fewer", 422);
      pageCount = metadata.pageCount;
      fields = metadata.fields;
    } else if (safeMime.startsWith("image/")) {
      pageCount = 1;
    }
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const ext = extFor(safeMime, name);
    const safeBase = sanitizeFileName(name);
    const safeName = ext && !safeBase.toLowerCase().endsWith(ext.toLowerCase()) ? `${safeBase}${ext}` : safeBase || `document${ext}`;
    const path = this.pathFor(id, ext);
    if (operationKey === undefined) {
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    } else {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        try {
          await link(temporary, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: safeMime,
      size: bytes.length,
      pageCount,
      fields,
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    if (operationKey === undefined) {
      await this.db.put(owner, "files", artifact);
      return this.signed(owner, artifact);
    }
    const persisted = await this.db.insertIfAbsent(owner, "files", artifact);
    return this.signed(owner, persisted ?? (await this.get(owner, id)));
  }
  signed(owner: string, file: Artifact): Artifact {
    return { ...file, url: this.auth.sign(owner, `/api/files/${file.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((f) => this.signed(owner, f));
  }
  async get(owner: string, id: string) {
    assertFileId(id);
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("File not found", 404);
    return file;
  }
  private pathFor(id: string, ext: string): string {
    assertFileId(id);
    const directory = resolve(this.config.dataDir, "files");
    const resolved = resolve(directory, `${id}${ext}`);
    if (!resolved.startsWith(`${directory}${sep}`)) throw new AppError("File not found", 404);
    return resolved;
  }
  async bytes(owner: string, id: string) {
    const file = await this.get(owner, id);
    const ext = extFor(file.mimeType, file.name) || extname(file.name);
    return readFile(this.pathFor(id, ext));
  }
  async delete(owner: string, id: string) {
    const file = await this.get(owner, id);
    const ext = extFor(file.mimeType, file.name) || extname(file.name);
    try {
      await rm(this.pathFor(id, ext), { force: true });
    } catch {}
    await this.db.remove(owner, "files", id);
    return { ok: true };
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>, operationKey?: string) {
    const file = await this.get(owner, id);
    if (file.mimeType !== "application/pdf") throw new AppError("Only PDFs can be filled", 400);
    const bytes = await this.bytes(owner, id);
    const output = await fillPdf(bytes, values);
    const base = file.name.replace(/\.pdf$/i, "");
    return this.import(
      owner,
      `${base} — filled.pdf`,
      output,
      "application/pdf",
      `Filled from ${file.name}`,
      id,
      operationKey
        ? JSON.stringify(["fill", operationKey, id, Object.keys(values).sort().map((n) => [n, values[n]])])
        : undefined,
    );
  }
}
