import { Directory } from "./directory.mjs";
import { promises as fs, watch as watchFs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const validId = (id) =>
  typeof id === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id) &&
  !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id);
const fail = (code, message) => Object.assign(new Error(message), { code });
const keys = ["id", "title", "category", "order", "created", "modified"];
const validModelImage = (value) => typeof value === "string" && /^[a-f0-9]{64}\.png$/.test(value);
const modelImageLimit = 8 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function assertModelImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > modelImageLimit ||
      !bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 1024 ||
      bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 1024 ||
      bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND")
    throw fail("IMAGE", "模型图片无效或超过 1024 像素 / 8 MB。");
}
const documentImageLimit = 20 * 1024 * 1024;
const documentImageReference = /^\.\.\/assets\/document-images\/([a-f0-9]{64})\.(png|jpg)$/;
// Inspect headers before native decoding, so pixel limits also protect imports.
export function inspectDocumentImage(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > documentImageLimit)
    throw fail("IMAGE", "正文图片必须为不超过 20 MB 的 PNG 或 JPEG 文件。");
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let width, height, extension;
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(pngSignature) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    let offset = 8, pixels = false, complete = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), end = offset + length + 12;
      if (end > bytes.length) break;
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (kind === "IDAT" && length > 0) pixels = true;
      if (kind === "IEND") { complete = length === 0 && end === bytes.length; break; }
      offset = end;
    }
    if (pixels && complete) extension = "png";
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2, scan = false;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker === 0xda) { scan = true; break; }
      if (length >= 11 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length !== 8 + 3 * bytes[offset + 7]) break;
        width = bytes.readUInt16BE(offset + 5);
        height = bytes.readUInt16BE(offset + 3);
      }
      offset += length;
    }
    if (scan && width && height) extension = "jpg";
  }
  if (!extension) throw fail("IMAGE", "正文图片格式无效，请选择完整的 PNG 或 JPEG 图片。");
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32000000)
    throw fail("IMAGE", "正文图片不能超过 3200 万像素，单边不能超过 16384 像素。");
  return { extension, mime: extension === "png" ? "image/png" : "image/jpeg", width, height };
}
const titleKey = (title) => title.trim().normalize("NFC").toLocaleLowerCase();
const encode = (doc) =>
  `---\n${[...keys, ...(doc.modelImage ? ["modelImage"] : [])].map((key) => `${key}: ${JSON.stringify(doc[key])}`).join("\n")}\n---\n${doc.body}`;
function decode(raw, filename, stat) {
  let meta = {},
    body = raw;
  if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw fail("FORMAT", "文档的 front matter 未闭合。");
    for (const line of match[1].split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const item = line.match(/^([a-zA-Z]+):\s*(.*?)\s*$/);
      if (!item || Object.hasOwn(meta, item[1]))
        throw fail("FORMAT", "front matter 字段无效或重复。");
      const value = item[2];
      try {
        meta[item[1]] = JSON.parse(value);
      } catch {
        if (/^[\[\]{&*!>|]/.test(value) || value.startsWith('"'))
          throw fail("FORMAT", "仅支持单行 YAML 标量；请检查 front matter。");
        meta[item[1]] =
          value.startsWith("'") && value.endsWith("'")
            ? value.slice(1, -1).replaceAll("''", "'")
            : value;
      }
    }
    body = raw.slice(match[0].length);
    if (!meta.id || !meta.title)
      throw fail("FORMAT", "front matter 缺少 id 或 title。");
  }
  const id = meta.id ?? `external-${hash(filename).slice(0, 24)}`;
  if (!validId(id)) throw fail("INVALID_ID", "文档 ID 无效。");
  if (meta.modelImage !== undefined && !validModelImage(meta.modelImage))
    throw fail("FORMAT", "模型图片引用无效。");
  const doc = {
    id,
    title: meta.title ?? filename.replace(/\.md$/i, ""),
    category: meta.category ?? "未分类",
    order: meta.order ?? 1000000,
    created: meta.created ?? stat.birthtime.toISOString(),
    modified: meta.modified ?? stat.mtime.toISOString(),
    body,
    revision: hash(raw),
    ...(meta.modelImage ? { modelImage: meta.modelImage } : {}),
  };
  if (
    typeof doc.title !== "string" ||
    !doc.title.trim() ||
    doc.title.length > 500 ||
    typeof doc.category !== "string" ||
    doc.category.length > 200 ||
    !Number.isFinite(doc.order) ||
    !Number.isFinite(Date.parse(doc.created)) ||
    !Number.isFinite(Date.parse(doc.modified))
  )
    throw fail("FORMAT", "文档元数据类型或日期无效。");
  return doc;
}

export class Repository {
  constructor(root, sampleRecords = [], sampleColumns = []) {
    this.root = path.resolve(root);
    this.sampleRecords = sampleRecords;
    this.sampleColumns = sampleColumns;
    this.directory = new Directory(this);
    this.watchers = [];
    this.queue = Promise.resolve();
    this.listInFlight = null;
    this.mutating = false;
    this.documentImageImports = new Map();
  }
  async safe(target, allowMissing = false) {
    const absolute = path.resolve(target);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw fail("PATH", "路径超出知识库。");
    // Check every ancestor, including ancestors above the library, to reject junctions.
    const parsed = path.parse(absolute);
    let current = parsed.root;
    for (const part of absolute
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw fail("SYMLINK", "知识库不支持符号链接或目录联接。");
      } catch (error) {
        if (error.code === "ENOENT" && allowMissing) return;
        throw error;
      }
    }
  }
  serialize(action) {
    const task = this.queue.then(async () => {
      // Concurrent renderer refreshes may share reads, never a write transaction.
      this.listInFlight = null;
      this.mutating = true;
      try {
        return await action();
      } finally {
        this.mutating = false;
        this.listInFlight = null;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async init() {
    await this.safe(this.root, true);
    await fs.mkdir(this.root, { recursive: true });
    for (const folder of ["documents", ".trash", "backups"]) {
      const target = path.join(this.root, folder);
      await this.safe(target, true);
      await fs.mkdir(target, { recursive: true });
    }
    for (const folder of ["", "documents", ".trash", "backups"]) {
      const probe = path.join(
        this.root,
        folder,
        `.write-probe-${randomUUID()}`,
      );
      try {
        await this.atomic(probe, "write probe\n", null);
        await fs.unlink(probe);
      } catch (error) {
        throw fail(
          error.code ?? "WRITE",
          `知识库目录不可写，请将程序和 RhineLabData 一起移到用户可写文件夹。${error.message}`,
        );
      }
    }
    await this.recoverMove();
    const marker = path.join(this.root, ".initialized");
    await this.safe(marker, true);
    let initialized = false;
    try {
      await fs.access(marker);
      initialized = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!initialized) {
      const pending = path.join(this.root, ".sample-import");
      await this.safe(pending, true);
      let importing = false;
      try {
        await fs.access(pending);
        importing = true;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const entries = [
        ...(await fs.readdir(path.join(this.root, "documents"))),
        ...(await fs.readdir(path.join(this.root, ".trash"))),
      ];
      if (importing || entries.length === 0) {
        await this.atomic(pending, "1\n");
        for (const [index, sample] of this.sampleRecords.entries()) {
          this.assertId(sample.id);
          const target = path.join(this.root, "documents", `${sample.id}.md`);
          try {
            await fs.access(target);
            continue;
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          const now = new Date().toISOString();
          const metadata = [
            ["英文名称", sample.en],
            ["部门", sample.department],
            ["档案日期", sample.date],
            ["负责人", sample.lead],
            ["访问级别", sample.clearance],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => `- **${label}**：${value}`)
            .join("\n");
          const source = /^https?:\/\/[^\s]+$/i.test(sample.source ?? "")
            ? `[参考来源](${sample.source})`
            : (sample.source ?? "");
          const body =
            sample.body ??
            `# ${sample.title}\n\n${metadata}\n\n## 摘要\n\n${sample.abstract ?? ""}\n\n## 研究记录\n\n${(sample.findings ?? []).map((item) => `- ${item}`).join("\n")}\n\n## 参考来源\n\n${source}\n`;
          await this.atomic(
            target,
            encode({
              id: sample.id,
              title: sample.title,
              category: sample.category ?? "未分类",
              order: index,
              created: now,
              modified: now,
              body,
            }),
            null,
          );
        }
      }
      await this.atomic(marker, "1\n");
      await fs.unlink(pending).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return this.list();
  }
  assertId(id) {
    if (!validId(id)) throw fail("INVALID_ID", "无效的文档 ID。");
  }
  async scan() {
    const result = { documents: [], trash: [], issues: [] },
      locations = new Map(),
      duplicates = new Set();
    for (const [folder, group] of [
      ["documents", "documents"],
      [".trash", "trash"],
    ]) {
      const directory = path.join(this.root, folder);
      await this.safe(directory);
      for (const filename of await fs.readdir(directory)) {
        if (!filename.toLowerCase().endsWith(".md")) continue;
        const target = path.join(directory, filename);
        try {
          await this.safe(target);
          const stat = await fs.stat(target);
          if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
            throw fail("FORMAT", "文档不是普通文件或超过 16 MB。");
          const doc = decode(await fs.readFile(target, "utf8"), filename, stat);
          if (locations.has(doc.id)) {
            duplicates.add(doc.id);
            throw fail("DUPLICATE", `重复的文档 ID：${doc.id}`);
          }
          locations.set(doc.id, { target, group, doc });
          result[group].push(doc);
        } catch (error) {
          result.issues.push({
            file: `${folder}/${filename}`,
            code: error.code ?? "READ",
            message: error.message,
          });
        }
      }
    }
    for (const id of duplicates) locations.delete(id);
    for (const group of ["documents", "trash"])
      result[group] = result[group]
        .filter((doc) => !duplicates.has(doc.id))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return { result, locations };
  }
  async list() {
    if (this.mutating)
      return this.directory.decorate((await this.scan()).result);
    // Share only an unfinished scan. The next completed request reads disk again,
    // including external changes that retain the same size and modification time.
    const snapshot = this.listInFlight ??= (async () =>
      this.directory.decorate((await this.scan()).result))();
    try {
      // Callers retain the independent result objects returned by fresh scans.
      return structuredClone(await snapshot);
    } finally {
      if (this.listInFlight === snapshot) this.listInFlight = null;
    }
  }
  async locate(id, trash = false) {
    this.assertId(id);
    if (typeof trash !== "boolean")
      throw fail("INPUT", "回收站参数必须为布尔值。");
    const { locations, result } = await this.scan();
    const entry = locations.get(id);
    if (!entry || entry.group !== (trash ? "trash" : "documents"))
      throw fail(
        "NOT_FOUND",
        result.issues.some((issue) => issue.code === "DUPLICATE")
          ? "找不到文档；请先解决重复 ID。"
          : "文档已被移动或删除。",
      );
    return entry;
  }
  async read(id, trash = false) {
    const doc = (await this.locate(id, trash)).doc;
    return (await this.directory.decorate({documents:[doc],trash:[],issues:[]})).documents[0];
  }
  async modelImageEntry(id, revision) {
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
      throw fail("INPUT", "修改模型图片需要有效的文档版本。");
    const entry = await this.locate(id);
    if (entry.doc.revision !== revision)
      throw fail("CONFLICT", "文件已被修改，请重新载入后设置模型图片。");
    return entry;
  }
  async readModelImage(id, expectedRef) {
    if (!validModelImage(expectedRef)) throw fail("INPUT", "模型图片引用无效。");
    const { doc } = await this.locate(id);
    if (doc.modelImage !== expectedRef)
      throw fail("CONFLICT", "模型图片已变化，请刷新后重试。");
    const target = path.join(this.root, "assets", "model-images", expectedRef);
    await this.safe(target);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > modelImageLimit)
      throw fail("IMAGE", "模型图片不是普通文件或超过 8 MB。");
    const bytes = await fs.readFile(target);
    assertModelImage(bytes);
    if (`${hash(bytes)}.png` !== expectedRef) throw fail("IMAGE", "模型图片内容与引用不一致。");
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  setModelImage(id, revision, bytes) {
    return this.serialize(async () => {
      const entry = await this.modelImageEntry(id, revision);
      assertModelImage(bytes);
      const modelImage = `${hash(bytes)}.png`;
      const folder = path.join(this.root, "assets", "model-images");
      await this.safe(folder, true);
      await fs.mkdir(folder, { recursive: true });
      const target = path.join(folder, modelImage);
      await this.safe(target, true);
      let existing;
      try { existing = await fs.readFile(target); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (existing && !existing.equals(bytes)) throw fail("IMAGE", "已有模型图片内容不一致。");
      if (!existing) await this.atomic(target, bytes, null);
      if (entry.doc.modelImage === modelImage) return this.read(id);
      await this.backup(entry);
      await this.atomic(entry.target, encode({ ...entry.doc, modelImage, modified: new Date().toISOString() }), revision);
      return this.read(id);
    });
  }
  removeModelImage(id, revision) {
    return this.serialize(async () => {
      const entry = await this.modelImageEntry(id, revision);
      if (!entry.doc.modelImage) return this.read(id);
      const doc = { ...entry.doc, modified: new Date().toISOString() };
      delete doc.modelImage;
      // Keep content-addressed files: existing backups and recycled documents may reference them.
      await this.backup(entry);
      await this.atomic(entry.target, encode(doc), revision);
      return this.read(id);
    });
  }
  async importDocumentImage(id, input) {
    const info = inspectDocumentImage(input);
    // Own the byte snapshot before queuing a write; callers may reuse their view.
    const bytes = Buffer.from(input);
    return this.serialize(async () => {
      await this.locate(id);
      const name = `${hash(bytes)}.${info.extension}`;
      const src = `../assets/document-images/${name}`;
      const folder = path.join(this.root, "assets", "document-images");
      await this.safe(folder, true);
      await fs.mkdir(folder, { recursive: true });
      const target = path.join(folder, name);
      await this.safe(target, true);
      let existing;
      try {
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size !== bytes.length) throw fail("IMAGE", "已有正文图片内容不一致。");
        existing = await fs.readFile(target);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (existing && !existing.equals(bytes)) throw fail("IMAGE", "已有正文图片内容不一致。");
      if (!existing) await this.atomic(target, bytes, null);
      let imported = this.documentImageImports.get(id);
      if (!imported) this.documentImageImports.set(id, imported = new Set());
      imported.add(src);
      // The editor saves Markdown through its normal Ctrl+S/revision workflow.
      return { src, dataUrl: `data:${info.mime};base64,${bytes.toString("base64")}` };
    });
  }
  async readDocumentImage(id, src) {
    const reference = typeof src === "string" && documentImageReference.exec(src);
    if (!reference) throw fail("INPUT", "正文图片引用无效。");
    this.assertId(id);
    const { locations } = await this.scan();
    const entry = locations.get(id);
    if (!entry) throw fail("NOT_FOUND", "文档已被移动或删除。");
    if (!entry.doc.body.includes(src) && !this.documentImageImports.get(id)?.has(src))
      throw fail("IMAGE_REFERENCE", "图片不属于该文档已保存的正文或本次导入。");
    const target = path.join(this.root, "assets", "document-images", `${reference[1]}.${reference[2]}`);
    await this.safe(target);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > documentImageLimit) throw fail("IMAGE", "正文图片不是普通文件或超过 20 MB。");
    const bytes = await fs.readFile(target);
    const info = inspectDocumentImage(bytes);
    if (hash(bytes) !== reference[1] || info.extension !== reference[2])
      throw fail("IMAGE", "正文图片内容与引用不一致。");
    // A saved image may be removed, saved, then restored by undo this session.
    let available = this.documentImageImports.get(id);
    if (!available) this.documentImageImports.set(id, available = new Set());
    available.add(src);
    return `data:${info.mime};base64,${bytes.toString("base64")}`;
  }
  validateInput(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 500 ||
      typeof input.category !== "string" ||
      input.category.length > 200 ||
      typeof input.body !== "string" ||
      Buffer.byteLength(input.body) > 15 * 1024 * 1024
    )
      throw fail("INPUT", "标题、分类或正文无效（正文上限 15 MB）。");
  }
  async validateCategory(input) {
    if(input.categoryId===undefined)return;
    if(input.categoryId!==null){this.assertId(input.categoryId);const {value}=await this.directory.load();if(!value.categories.some(c=>c.id===input.categoryId))throw fail('NOT_FOUND','分类已被移除。');}
  }
  assertUniqueTitle(documents, title, exceptId) {
    if (
      documents.some(
        (doc) => doc.id !== exceptId && titleKey(doc.title) === titleKey(title),
      )
    )
      throw fail("DUPLICATE_TITLE", "已有同名文档，请修改标题后重试。");
  }
  async atomic(target, content, expected) {
    await this.safe(target, true);
    const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await this.safe(target, true);
      if (expected !== undefined) {
        let current = null;
        try {
          current = hash(await fs.readFile(target));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        if (current !== expected)
          throw fail(
            "CONFLICT",
            "文件已被其他程序修改，请先重新载入或另存为新文档。",
          );
      }
      await fs.rename(temporary, target);
      // Directory fsync is supported on POSIX; Windows rejects opening directories.
      if (process.platform !== "win32") {
        const dir = await fs.open(path.dirname(target), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
  }
  async backup(entry) {
    await this.safe(entry.target);
    const bytes = await fs.readFile(entry.target);
    if (hash(bytes) !== entry.doc.revision)
      throw fail("CONFLICT", "文件已被其他程序修改，请重新载入。");
    const target = path.join(
      this.root,
      "backups",
      `${entry.doc.id}-${Date.now()}-${randomUUID()}.md`,
    );
    await this.atomic(target, bytes, null);
  }
  create(input) {
    return this.serialize(async () => {
      this.validateInput(input);
      await this.validateCategory(input);
      const { documents } = await this.list(),
        now = new Date().toISOString();
      this.assertUniqueTitle(documents, input.title);
      const doc = {
        id: randomUUID(),
        title: input.title.trim(),
        category: input.category,
        body: input.body,
        order: Math.max(-1, ...documents.map((item) => item.order)) + 1,
        created: now,
        modified: now,
      };
      const raw = encode(doc);
      await this.atomic(
        path.join(this.root, "documents", `${doc.id}.md`),
        raw,
        null,
      );
      await this.directory.assign(doc.id, input.category, input.categoryId);
      return this.read(doc.id);
    });
  }
  save(input) {
    return this.serialize(async () => {
      this.validateInput(input);
      await this.validateCategory(input);
      if (
        typeof input.revision !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.revision)
      )
        throw fail("INPUT", "保存需要有效的文档版本。");
      const entry = await this.locate(input.id);
      if (input.revision !== entry.doc.revision)
        throw fail("CONFLICT", "文件已被修改，请重新载入或另存为新文档。");
      this.assertUniqueTitle(
        (await this.list()).documents,
        input.title,
        input.id,
      );
      const doc = {
        ...entry.doc,
        title: input.title.trim(),
        category: input.category,
        body: input.body,
        modified: new Date().toISOString(),
      };
      const raw = encode(doc);
      await this.backup(entry);
      await this.atomic(entry.target, raw, input.revision);
      await this.directory.assign(doc.id, input.category, input.categoryId);
      return this.read(doc.id);
    });
  }
  reorder(ids) {
    return this.serialize(async () => {
      if (
        !Array.isArray(ids) ||
        ids.length > 100000 ||
        ids.some((id) => !validId(id)) ||
        new Set(ids).size !== ids.length
      )
        throw fail("INPUT", "排序包含重复或无效 ID。");
      const { result, locations } = await this.scan();
      if (
        ids.length !== result.documents.length ||
        ids.some(
          (id) => !locations.has(id) || locations.get(id).group !== "documents",
        )
      )
        throw fail("CONFLICT", "文档列表已变化，请刷新后重新排序。");
      for (const [index, id] of ids.entries()) {
        const entry = locations.get(id);
        if (entry.doc.order === index) continue;
        await this.backup(entry);
        await this.atomic(
          entry.target,
          encode({ ...entry.doc, order: index }),
          entry.doc.revision,
        );
      }
      return this.list();
    });
  }
  createCategory(name) {
    return this.serialize(async()=>{
      if(typeof name!=='string'||!name.trim()||name.length>200)throw fail('INPUT','请输入分类名称（最多200字）。');
      let created;await this.directory.change(value=>{if(value.categories.some(c=>titleKey(c.name)===titleKey(name)))throw fail('DUPLICATE_TITLE','已有同名分类。');created={id:randomUUID(),name:name.trim(),lane:value.nextLane++};value.categories.push(created);});return created;
    });
  }
  renameCategory(id,name) {
    return this.serialize(async()=>{this.assertId(id);if(typeof name!=='string'||!name.trim()||name.length>200)throw fail('INPUT','分类名称无效。');await this.directory.change(value=>{const c=value.categories.find(c=>c.id===id);if(!c)throw fail('NOT_FOUND','分类已被移除。');if(value.categories.some(other=>other.id!==id&&titleKey(other.name)===titleKey(name)))throw fail('DUPLICATE_TITLE','已有同名分类。');c.name=name.trim();});return this.list();});
  }
  removeCategory(id) {
    return this.serialize(async()=>{this.assertId(id);const {result}=await this.scan();await this.directory.change(value=>{if(!value.categories.some(c=>c.id===id))throw fail('NOT_FOUND','分类已被移除。');for(const doc of [...result.documents,...result.trash])if(this.directory.member(value,doc)===id)value.assignments[doc.id]=null;value.categories=value.categories.filter(c=>c.id!==id);});return this.list();});
  }
  moveDocument(id,categoryId) {
    return this.serialize(async()=>{this.assertId(id);const entry=await this.locate(id);const {value}=await this.directory.load();const c=value.categories.find(c=>c.id===categoryId);if(categoryId!==null&&!c)throw fail('NOT_FOUND','分类已被移除。');const {documents}=await this.list();const doc={...entry.doc,category:c?.name??'未分类',order:Math.max(-1,...documents.map(d=>d.order))+1};await this.backup(entry);await this.atomic(entry.target,encode(doc),entry.doc.revision);await this.directory.assign(id,doc.category,categoryId);return this.read(id);});
  }
  async move(id, toTrash, revision) {
    await this.recoverMove();
    const entry = await this.locate(id, !toTrash);
    if (toTrash && revision !== entry.doc.revision)
      throw fail("CONFLICT", "文档已修改，请刷新后再删除。");
    if (!toTrash)
      this.assertUniqueTitle(
        (await this.list()).documents,
        entry.doc.title,
        id,
      );
    const destination = path.join(
      this.root,
      toTrash ? ".trash" : "documents",
      `${id}.md`,
    );
    await this.safe(destination, true);
    // Unindexed files still own their paths: do not journal a move over them.
    try {
      await fs.lstat(destination);
      throw fail("CONFLICT", "目标路径已有文件，移动已取消。");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this.backup(entry);
    // Persist intent first. Recovery completes or rolls back an interrupted move;
    // the destination itself is exposed only after a fully flushed atomic write.
    const raw = encode(entry.doc);
    const journal = path.join(this.root, ".move.json");
    await this.atomic(
      journal,
      JSON.stringify({
        source: path.relative(this.root, entry.target),
        destination: path.relative(this.root, destination),
        before: entry.doc.revision,
        after: hash(raw),
      }),
      null,
    );
    try {
      await this.atomic(destination, raw, null);
    } catch (error) {
      // A revision conflict precedes commit: cancel only our intent, never
      // the destination now owned by an external writer.
      if (error.code === "CONFLICT") await fs.unlink(journal);
      throw error;
    }
    await this.safe(entry.target);
    if (hash(await fs.readFile(entry.target)) !== entry.doc.revision) {
      // Recovery checks the destination revision before rolling it back.
      // Preserve both files if an external editor changed the destination too.
      await this.recoverMove();
      throw fail("CONFLICT", "文档已修改，移动已取消。");
    }
    await fs.unlink(entry.target);
    await fs.unlink(journal);
    return this.read(id, toTrash);
  }
  async recoverMove() {
    const journal = path.join(this.root, ".move.json");
    await this.safe(journal, true);
    let intent;
    try {
      const stat = await fs.stat(journal);
      if (stat.size > 16384)
        throw fail(
          "FORMAT",
          "移动恢复记录异常，请保留知识库并检查 .move.json。",
        );
      intent = JSON.parse(await fs.readFile(journal, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const allowed = (value) =>
      typeof value === "string" &&
      /^(documents|\.trash)[/\\][^/\\]+\.md$/i.test(value) &&
      !value.includes(":") &&
      !value.includes("\0");
    if (
      !intent ||
      !allowed(intent.source) ||
      !allowed(intent.destination) ||
      path.dirname(intent.source) === path.dirname(intent.destination) ||
      !/^[a-f0-9]{64}$/.test(intent.before) ||
      !/^[a-f0-9]{64}$/.test(intent.after)
    )
      throw fail("FORMAT", "移动恢复记录无效，请保留知识库并检查 .move.json。");
    const source = path.join(this.root, intent.source),
      destination = path.join(this.root, intent.destination);
    const revision = async (target) => {
      await this.safe(target, true);
      try {
        return hash(await fs.readFile(target));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    };
    const before = await revision(source),
      after = await revision(destination);
    if (after !== null && after !== intent.after)
      throw fail(
        "CONFLICT",
        "未完成移动的目标文件已被修改，请保留两个文件及 .move.json 后手动检查。",
      );
    if (after === intent.after && before === intent.before)
      await fs.unlink(source);
    else if (after === intent.after && before !== null)
      await fs.unlink(destination);
    else if (after === null && before === null)
      throw fail(
        "CONFLICT",
        "移动恢复找不到源文件和目标文件，请检查 backups 目录。",
      );
    await fs.unlink(journal);
  }
  trash(id, revision) {
    return this.serialize(() => this.move(id, true, revision));
  }
  restore(id) {
    return this.serialize(() => this.move(id, false));
  }
  purge(id) {
    return this.serialize(async () => {
      const entry = await this.locate(id, true);
      await this.safe(entry.target);
      await fs.unlink(entry.target);
      return { id };
    });
  }
  watch(callback) {
    let timer;
    const notify = () => {
      // Invalidate immediately; UI notification remains debounced.
      this.listInFlight = null;
      clearTimeout(timer);
      timer = setTimeout(() => callback(), 180);
    };
    const watchers = ["", "documents", ".trash"].map((folder) => {
      const watcher = watchFs(path.join(this.root, folder), notify);
      watcher.on("error", notify);
      return watcher;
    });
    const close = () => {
      clearTimeout(timer);
      watchers.forEach((watcher) => watcher.close());
    };
    this.watchers.push(close);
    return close;
  }
  close() {
    this.watchers.splice(0).forEach((close) => close());
    this.documentImageImports.clear();
  }
}
