import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../desktop/repository.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "rhine-model-images-"));
const root = path.join(temporary, "RhineLabData");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=", "base64");
let repository = new Repository(root);
const input = { title: "模型图片测试", category: "未分类", body: "# 正文\n\n保持 Markdown 内容。\n" };
try {
  await repository.init();
  let doc = await repository.create(input);
  const initial = doc;
  doc = await repository.setModelImage(doc.id, doc.revision, png);
  assert.match(doc.modelImage, /^[a-f0-9]{64}\.png$/);
  assert.equal(doc.body, input.body);
  assert.notEqual(doc.revision, initial.revision);
  const reference = doc.modelImage;
  const asset = path.join(root, "assets", "model-images", reference);
  assert.deepEqual(await fs.readFile(asset), png);
  assert.equal(await repository.readModelImage(doc.id, reference), `data:image/png;base64,${png.toString("base64")}`);
  assert.equal((await repository.list()).documents[0].modelImage, reference);
  await assert.rejects(repository.setModelImage(doc.id, initial.revision, png), { code: "CONFLICT" });
  await assert.rejects(repository.removeModelImage(doc.id, initial.revision), { code: "CONFLICT" });
  await assert.rejects(repository.setModelImage("../outside", doc.revision, png), { code: "INVALID_ID" });
  await assert.rejects(repository.setModelImage(doc.id, {}, png), { code: "INPUT" });
  await assert.rejects(repository.readModelImage(doc.id, "../outside.png"), { code: "INPUT" });
  await assert.rejects(repository.readModelImage(doc.id, `${"a".repeat(64)}.png`), { code: "CONFLICT" });
  for (const bytes of [Buffer.alloc(0), Buffer.from("not an image"), png.subarray(0, 30), Buffer.alloc(8 * 1024 * 1024 + 1)])
    await assert.rejects(repository.setModelImage(doc.id, doc.revision, bytes), { code: "IMAGE" });
  const huge = Buffer.from(png);
  huge.writeUInt32BE(1025, 16);
  await assert.rejects(repository.setModelImage(doc.id, doc.revision, huge), { code: "IMAGE" });
  assert.equal((await repository.read(doc.id)).revision, doc.revision, "invalid image edits leave the document intact");

  doc = await repository.save({ ...doc, body: "更新正文\n", modelImage: "../forged.png" });
  assert.equal(doc.modelImage, reference, "ordinary saves preserve the disk image reference");
  const category = await repository.createCategory("图片分类");
  doc = await repository.moveDocument(doc.id, category.id);
  assert.equal(doc.modelImage, reference);
  const second = await repository.create({ ...input, title: "第二篇" });
  await repository.reorder([second.id, doc.id]);
  doc = await repository.read(doc.id);
  assert.equal(doc.modelImage, reference, "reordering retains the image");
  await repository.renameCategory(category.id, "更名分类");
  doc = await repository.read(doc.id);
  assert.equal(doc.modelImage, reference, "category edits retain the image");
  await repository.trash(doc.id, doc.revision);
  assert.equal((await repository.list()).trash[0].modelImage, reference);
  await assert.rejects(repository.readModelImage(doc.id, reference), { code: "NOT_FOUND" });
  await repository.restore(doc.id);
  doc = await repository.read(doc.id);
  assert.equal(doc.modelImage, reference, "recycled documents restore their image");
  repository.close();
  repository = new Repository(root);
  await repository.init();
  doc = await repository.read(doc.id);
  assert.equal(doc.modelImage, reference, "image selection survives a fresh repository instance");
  assert.equal(await repository.readModelImage(doc.id, reference), `data:image/png;base64,${png.toString("base64")}`);

  const raw = await fs.readFile(path.join(root, "documents", `${doc.id}.md`), "utf8");
  const originalRename = fs.rename;
  fs.rename = async (source, target) => {
    if (target === path.join(root, "documents", `${doc.id}.md`))
      throw Object.assign(new Error("simulated disk full"), { code: "ENOSPC" });
    return originalRename(source, target);
  };
  try { await assert.rejects(repository.removeModelImage(doc.id, doc.revision), { code: "ENOSPC" }); }
  finally { fs.rename = originalRename; }
  assert.equal(await fs.readFile(path.join(root, "documents", `${doc.id}.md`), "utf8"), raw, "failed image removal preserves the document");
  doc = await repository.removeModelImage(doc.id, doc.revision);
  assert.equal(doc.modelImage, undefined);
  assert.equal(doc.body, "更新正文\n");
  await assert.rejects(repository.readModelImage(doc.id, reference), { code: "CONFLICT" });
  assert.deepEqual(await fs.readFile(asset), png, "image removal retains assets used by backups");
  const backups = await fs.readdir(path.join(root, "backups"));
  assert.ok((await Promise.all(backups.map(file => fs.readFile(path.join(root, "backups", file), "utf8")))).some(text => text.includes(reference)));

  doc = await repository.setModelImage(doc.id, doc.revision, png);
  await fs.writeFile(asset, Buffer.from(png).fill(0, 40, 41));
  await assert.rejects(repository.readModelImage(doc.id, reference), { code: "IMAGE" });
  await assert.rejects(repository.setModelImage(doc.id, doc.revision, png), { code: "IMAGE" });
  await fs.writeFile(asset, png);
  const folder = path.dirname(asset);
  const moved = `${folder}-kept`;
  await fs.rename(folder, moved);
  await fs.symlink(moved, folder, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(repository.readModelImage(doc.id, reference), { code: "SYMLINK" });
  await assert.rejects(repository.setModelImage(doc.id, doc.revision, png), { code: "SYMLINK" });
  await fs.unlink(folder);
  await fs.rename(moved, folder);
  const target = path.join(root, "documents", `${doc.id}.md`);
  await fs.writeFile(target, raw.replace(reference, "../outside.png"));
  assert.ok((await repository.list()).issues.some(issue => issue.code === "FORMAT"));
  console.log("Model images: isolated persistence, stable IDs, revisions, regular saves, categories/order, recycle/restore, atomic failure, removal/backups, invalid images/references, integrity and symlink boundaries passed.");
} finally {
  repository.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
