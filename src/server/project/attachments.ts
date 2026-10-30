import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_BATCH_LIMIT,
  ATTACHMENT_COUNT_LIMIT,
  ATTACHMENT_LIMIT,
  type Attachment,
  type AttachmentInput,
} from "#model/attachment";
import { SfError } from "./errors.ts";
import { writeJson } from "./fsutil.ts";

const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Manifest = { files: Attachment[]; submissions: string[] };

/** Reject symlinks in every existing component, including ancestors of the storage directory. */
function safeAttachmentPath(file: string) {
  let current = path.resolve(file);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new SfError("invalid", "attachment storage contains a symlink");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = path.dirname(current);
    if (parent === current) return file;
    current = parent;
  }
}

export function attachmentStore(dir: string) {
  safeAttachmentPath(dir);
  const manifestPath = safeAttachmentPath(path.join(dir, "manifest.json"));
  const manifest: Manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { files: [], submissions: [] };
  return {
    list: () => manifest.files,
    hasSubmission(id?: string) {
      if (id !== undefined && !validId.test(id)) throw new SfError("invalid", "invalid submission id");
      return Boolean(id && manifest.submissions.includes(id));
    },
    get(id: string) {
      if (!validId.test(id)) throw new SfError("invalid", "invalid attachment id");
      const metadata = manifest.files.find((f) => f.id === id);
      if (!metadata) throw new SfError("not_found", `no attachment ${id}`);
      const file = safeAttachmentPath(path.join(dir, id));
      if (!fs.existsSync(file)) throw new SfError("not_found", `missing attachment bytes ${id}`);
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (!fs.fstatSync(fd).isFile()) throw new SfError("invalid", "attachment is not a regular file");
        return { metadata, bytes: fs.readFileSync(fd) };
      } finally {
        fs.closeSync(fd);
      }
    },
    /** Validate the entire batch first; roll back additions and the Story if any write fails. */
    commit(
      inputs: AttachmentInput[] = [],
      submissionId: string | undefined,
      writeStory: () => void,
      rollbackStory: () => void,
    ) {
      if (!Array.isArray(inputs)) throw new SfError("invalid", "attachments must be an array");
      if (inputs.length > ATTACHMENT_COUNT_LIMIT)
        throw new SfError("invalid", "at most 100 attachments per submission");
      let total = 0;
      const files = inputs.map((input) => {
        if (
          !input ||
          typeof input.name !== "string" ||
          !input.name.trim() ||
          input.name.length > 1024 ||
          Array.from(input.name).some((char) => char.charCodeAt(0) < 32)
        )
          throw new SfError("invalid", "attachment needs a usable filename");
        if (
          typeof input.data !== "string" ||
          input.data.length > Math.ceil(ATTACHMENT_LIMIT / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
        )
          throw new SfError("invalid", "invalid base64 or attachment exceeds 20 MiB");
        const bytes = Buffer.from(input.data, "base64");
        if (bytes.toString("base64") !== input.data) throw new SfError("invalid", "invalid base64");
        total += bytes.length;
        if (bytes.length > ATTACHMENT_LIMIT || total > ATTACHMENT_BATCH_LIMIT)
          throw new SfError("invalid", "attachment limit: 20 MiB per file, 40 MiB per submission");
        const mediaType =
          typeof input.mediaType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(input.mediaType)
            ? input.mediaType
            : "application/octet-stream";
        return { bytes, metadata: { id: crypto.randomUUID(), name: input.name, mediaType, size: bytes.length } };
      });
      const added: string[] = [];
      try {
        if (files.length || submissionId) fs.mkdirSync(dir, { recursive: true });
        for (const f of files) {
          const target = safeAttachmentPath(path.join(dir, f.metadata.id));
          const fd = fs.openSync(target, "wx");
          added.push(target);
          try {
            fs.writeFileSync(fd, f.bytes);
          } finally {
            fs.closeSync(fd);
          }
        }
        writeStory();
        if (files.length || submissionId)
          writeJson(manifestPath, {
            files: [...manifest.files, ...files.map((f) => f.metadata)],
            submissions: [...manifest.submissions, ...(submissionId ? [submissionId] : [])],
          });
      } catch (err) {
        for (const file of added) fs.rmSync(file, { force: true });
        rollbackStory();
        throw err;
      }
      return files.map((f) => f.metadata);
    },
  };
}
