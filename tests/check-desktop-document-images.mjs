import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Repository, inspectDocumentImage } from "../desktop/repository.mjs";

const run = path.resolve("verification/document-images-backend", String(Date.now()));
await fs.mkdir(run, { recursive: true });
const root = path.join(run, "RhineLabData");
let repository = new Repository(root), fresh;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const png = await fs.readFile(new URL("../public/icons/icon-512.png", import.meta.url));
const otherPng = await fs.readFile(new URL("../public/icons/icon-192.png", import.meta.url));
const jpg = await fs.readFile(new URL("../docs/media/array.jpg", import.meta.url));
const input = { title: "正文图片验证", category: "未分类", body: "# 正文\n\n插图前的文字。\n" };
const checks = {};
try {
  assert.equal(inspectDocumentImage(png).extension, "png");
  const jpegInfo = inspectDocumentImage(jpg);
  assert.equal(jpegInfo.extension, "jpg");
  assert(Math.max(jpegInfo.width, jpegInfo.height) > 1024, "JPEG fixture verifies original-resolution preservation");
  await repository.init();
  let doc = await repository.create(input);
  doc = await repository.setModelImage(doc.id, doc.revision, png);
  const beforeImport = await repository.read(doc.id);
  const pngImport = await repository.importDocumentImage(doc.id, png);
  const jpgImport = await repository.importDocumentImage(doc.id, new Uint8Array(jpg));
  assert.equal(pngImport.src, `../assets/document-images/${hash(png)}.png`);
  assert.equal(jpgImport.src, `../assets/document-images/${hash(jpg)}.jpg`);
  assert.equal(pngImport.dataUrl, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(jpgImport.dataUrl, `data:image/jpeg;base64,${jpg.toString("base64")}`);
  assert.deepEqual(await repository.read(doc.id), beforeImport, "import does not change body, metadata, revision or model image");
  const folder = path.join(root, "assets", "document-images");
  const pngTarget = path.join(folder, `${hash(png)}.png`), jpgTarget = path.join(folder, `${hash(jpg)}.jpg`);
  assert.deepEqual(await fs.readFile(pngTarget), png);
  assert.deepEqual(await fs.readFile(jpgTarget), jpg, "original JPEG bytes are never resized or recompressed");
  const padded = Buffer.concat([Buffer.alloc(7), png, Buffer.alloc(5)]);
  assert.equal((await repository.importDocumentImage(doc.id, padded.subarray(7, 7 + png.length))).src, pngImport.src);
  assert.equal((await fs.readdir(folder)).length, 2, "identical bytes deduplicate across byte views");
  assert.equal(await repository.readDocumentImage(doc.id, pngImport.src), pngImport.dataUrl, "session imports are readable before saving Markdown");
  const other = await repository.create({ ...input, title: "另一份文档" });
  await assert.rejects(repository.readDocumentImage(other.id, pngImport.src), { code: "IMAGE_REFERENCE" });
  fresh = new Repository(root);
  await fresh.init();
  await assert.rejects(fresh.readDocumentImage(doc.id, pngImport.src), { code: "IMAGE_REFERENCE" }, "unsaved import permission is confined to its repository session");
  fresh.close();
  checks.originalBytesAndUnsavedSession = true;

  for (const bytes of [null, [], {}, Buffer.alloc(0), Buffer.from("<svg/>"), png.subarray(0, 25), jpg.subarray(0, 20), Buffer.alloc(20 * 1024 * 1024 + 1)])
    await assert.rejects(repository.importDocumentImage(doc.id, bytes), { code: "IMAGE" });
  for (const [width, height] of [[0, 1], [16385, 1], [8192, 8192]]) {
    const dimensions = Buffer.from(png);
    dimensions.writeUInt32BE(width, 16); dimensions.writeUInt32BE(height, 20);
    await assert.rejects(repository.importDocumentImage(doc.id, dimensions), { code: "IMAGE" });
  }
  await assert.rejects(repository.importDocumentImage("../outside", png), { code: "INVALID_ID" });
  await assert.rejects(repository.importDocumentImage("missing-document", png), { code: "NOT_FOUND" });
  await assert.rejects(repository.readDocumentImage("../outside", pngImport.src), { code: "INVALID_ID" });
  for (const src of [null, {}, "file:///C:/secret.png", "https://example.test/image.png", pngImport.dataUrl,
    `../assets/document-images/../${hash(png)}.png`, `../assets/document-images/${hash(png).toUpperCase()}.png`,
    `..\\assets\\document-images\\${hash(png)}.png`, `../assets/document-images/${hash(png)}.png?x=1`,
    `../assets/model-images/${hash(png)}.png`, `/assets/document-images/${hash(png)}.png`])
    await assert.rejects(repository.readDocumentImage(doc.id, src), { code: "INPUT" });
  assert.deepEqual(await repository.read(doc.id), beforeImport);
  checks.inputAndPathBoundaries = true;

  const failedTarget = path.join(folder, `${hash(otherPng)}.png`);
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if (destination === failedTarget) throw Object.assign(new Error("simulated full disk"), { code: "ENOSPC" });
    return originalRename(source, destination);
  };
  try { await assert.rejects(repository.importDocumentImage(other.id, otherPng), { code: "ENOSPC" }); }
  finally { fs.rename = originalRename; }
  assert.equal((await fs.readdir(folder)).some(name => name.endsWith(".tmp")), false);
  await assert.rejects(fs.access(failedTarget), { code: "ENOENT" });
  assert.deepEqual(await repository.read(other.id), other, "failed asset writes cannot modify the document");
  checks.atomicFailure = true;

  const body = `${input.body}\n![PNG 原图](${pngImport.src})\n\n![JPEG 原图](${jpgImport.src})\n`;
  doc = await repository.save({ ...doc, body });
  assert.equal(doc.modelImage, beforeImport.modelImage, "body attachments do not replace the existing model image");
  assert.equal(doc.body, body);
  fresh = new Repository(root);
  await fresh.init();
  assert.equal(await fresh.readDocumentImage(doc.id, pngImport.src), pngImport.dataUrl);
  assert.equal(await fresh.readDocumentImage(doc.id, jpgImport.src), jpgImport.dataUrl);
  doc = await fresh.save({ ...doc, body: input.body });
  assert.equal(await fresh.readDocumentImage(doc.id, pngImport.src), pngImport.dataUrl, "an authorized saved image remains available for undo after saving its removal");
  doc = await fresh.save({ ...doc, body });
  fresh.close();
  await repository.trash(doc.id, doc.revision);
  assert.equal(await repository.readDocumentImage(doc.id, jpgImport.src), jpgImport.dataUrl, "recycled documents remain readable");
  await assert.rejects(repository.importDocumentImage(doc.id, png), { code: "NOT_FOUND" });
  await repository.restore(doc.id);
  doc = await repository.read(doc.id);
  assert.equal(doc.body, body);
  assert.equal(await repository.readDocumentImage(doc.id, pngImport.src), pngImport.dataUrl);
  checks.saveRestartAndRecycle = true;

  const damaged = Buffer.from(png);
  damaged[damaged.length - 20] ^= 1;
  await fs.writeFile(pngTarget, damaged);
  await assert.rejects(repository.readDocumentImage(doc.id, pngImport.src), { code: "IMAGE" });
  await assert.rejects(repository.importDocumentImage(doc.id, png), { code: "IMAGE" });
  await fs.writeFile(pngTarget, png);
  const linkedRoot = path.join(run, "linked-library");
  const linkedRepo = new Repository(linkedRoot);
  await linkedRepo.init();
  let linkedDoc = await linkedRepo.create({ ...input, body });
  const linkedAssets = path.join(linkedRoot, "assets"), linkedFolder = path.join(linkedAssets, "document-images");
  await fs.mkdir(linkedAssets);
  await fs.symlink(folder, linkedFolder, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(linkedRepo.readDocumentImage(linkedDoc.id, pngImport.src), { code: "SYMLINK" });
    await assert.rejects(linkedRepo.importDocumentImage(linkedDoc.id, png), { code: "SYMLINK" });
  } finally {
    linkedRepo.close();
    // Remove only this one explicitly named test link, never its target tree.
    await fs.unlink(linkedFolder);
  }
  checks.contentIntegrityAndSymlinks = true;

  doc = await repository.save({ ...doc, body: input.body });
  assert.equal(doc.body, input.body);
  assert.deepEqual(await fs.readFile(pngTarget), png);
  assert.deepEqual(await fs.readFile(jpgTarget), jpg);
  const backups = await fs.readdir(path.join(root, "backups"));
  const texts = await Promise.all(backups.map(name => fs.readFile(path.join(root, "backups", name), "utf8")));
  assert(texts.some(text => text.includes(pngImport.src) && text.includes(jpgImport.src)), "backups retain image references and assets");
  repository.close();
  repository = new Repository(root);
  await repository.init();
  await assert.rejects(repository.readDocumentImage(doc.id, pngImport.src), { code: "IMAGE_REFERENCE" }, "a new session cannot read an unrelated retained asset");
  checks.removeAndBackup = true;
  await fs.writeFile(path.join(run, "result.json"), JSON.stringify({ passed: true, run, checks }, null, 2));
  console.log("Document images: original PNG/JPEG, content addressing, isolated unsaved access, input/path limits, atomic failures, save/restart, recycle/restore, model-image independence, integrity/symlinks and retained backups passed.");
  console.log(`Retained test fixtures (no recursive cleanup): ${run}`);
} catch (error) {
  await fs.writeFile(path.join(run, "result.json"), JSON.stringify({ passed: false, run, checks, error: error.stack || String(error) }, null, 2));
  throw error;
} finally {
  fresh?.close();
  repository.close();
  // User policy requires separate approval before batch fixture cleanup.
  console.log(`Test fixture directory retained: ${run}`);
}
