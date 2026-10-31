import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Repository } from "../desktop/repository.mjs";

const run = path.resolve("release/document-images-test/history", String(Date.now()));
await fs.mkdir(run, { recursive: true });
const root = path.join(run, "RhineLabData"), backups = path.join(root, "backups");
const repository = new Repository(root);
let restarted;
const checks = {};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const keyFile = key => path.join(backups, key.slice(0, key.lastIndexOf("@")));
try {
  await repository.init();
  const first = await repository.create({ title: "初版研究", category: "未分类", body: "# 初版\n\n中文第一版。\n" });
  assert.deepEqual(await repository.listHistory(first.id), []);
  const second = await repository.save({ ...first, title: "第二版研究", body: "# 第二版\n\n补充观察。\n" });
  const third = await repository.save({ ...second, body: "# 当前稿\n\n最终观察。\n" });
  const entries = await repository.listHistory(first.id);
  assert.equal(entries.length, 2);
  assert(entries.every(entry => entry.key.startsWith(first.id + "-") && entry.key.endsWith("@" + entry.revision)));
  assert.deepEqual(entries.map(entry => entry.savedAt), entries.map(entry => entry.savedAt).sort().reverse());
  const firstEntry = entries.find(entry => entry.revision === first.revision);
  assert(firstEntry);
  assert.equal((await repository.readHistory(first.id, firstEntry.key)).body, first.body);
  const firstBytes = await fs.readFile(keyFile(firstEntry.key));
  assert.equal(sha(firstBytes), firstEntry.revision);
  assert.equal(firstBytes.length, firstEntry.bytes);
  await assert.rejects(repository.restoreHistory(first.id, firstEntry.key, second.revision), { code: "CONFLICT" });
  assert.equal((await repository.listHistory(first.id)).length, 2);
  const restored = await repository.restoreHistory(first.id, firstEntry.key, third.revision);
  assert.equal(restored.id, first.id); assert.equal(restored.created, first.created);
  assert.equal(restored.title, first.title); assert.equal(restored.body, first.body);
  assert.notEqual(restored.revision, first.revision); assert.notEqual(restored.revision, third.revision);
  const restoredHistory = await repository.listHistory(first.id);
  const beforeRestore = restoredHistory.find(entry => entry.revision === third.revision);
  assert(beforeRestore, "restoration first backs up the current version");
  assert.equal((await repository.readHistory(first.id, beforeRestore.key)).body, third.body);
  checks.recoveryWithRevisionAndUndoPath = true;

  const other = await repository.create({ title: "其他文档", category: "未分类", body: "不关联。\n" });
  for (const key of ["../documents/other.md", "..\\other.md", firstEntry.key.replace(first.id, other.id), {}, firstEntry.key + "/x"]) {
    await assert.rejects(repository.readHistory(first.id, key), { code: "INPUT" });
    await assert.rejects(repository.restoreHistory(first.id, key, restored.revision), { code: "INPUT" });
  }
  await assert.rejects(repository.listHistory("../outside"), { code: "INVALID_ID" });
  await assert.rejects(repository.readHistory(other.id, firstEntry.key), { code: "INPUT" });
  await assert.rejects(repository.restoreHistory(first.id, firstEntry.key, null), { code: "INPUT" });
  checks.opaqueKeysAndDocumentScope = true;

  const file = keyFile(firstEntry.key);
  await fs.writeFile(file, Buffer.concat([firstBytes, Buffer.from("\n篡改") ]));
  await assert.rejects(repository.readHistory(first.id, firstEntry.key), { code: "CONFLICT" });
  await assert.rejects(repository.restoreHistory(first.id, firstEntry.key, restored.revision), { code: "CONFLICT" });
  assert.equal((await repository.read(first.id)).revision, restored.revision);
  await fs.writeFile(file, firstBytes);
  const documentFile = path.join(root, "documents", first.id + ".md");
  await fs.appendFile(documentFile, "\n外部编辑");
  await assert.rejects(repository.restoreHistory(first.id, firstEntry.key, restored.revision), { code: "CONFLICT" });
  assert((await repository.read(first.id)).body.includes("外部编辑"));
  checks.externalCurrentAndSnapshotConflict = true;

  // Matching filenames cannot smuggle snapshots belonging to another document.
  const foreign = await fs.readFile(path.join(root, "documents", other.id + ".md"));
  const foreignName = `${first.id}-${Date.now()}-${randomUUID()}.md`;
  await fs.writeFile(path.join(backups, foreignName), foreign);
  const malformedName = `${first.id}-${Date.now()}-${randomUUID()}.md`;
  await fs.writeFile(path.join(backups, malformedName), "---\nid: broken\n");
  assert(!(await repository.listHistory(first.id)).some(entry => entry.key.startsWith(foreignName) || entry.key.startsWith(malformedName)));
  await assert.rejects(repository.readHistory(first.id, foreignName + "@" + sha(foreign)), { code: "HISTORY" });
  checks.invalidSnapshotsIsolated = true;

  // An old external plain Markdown file gets its ID from its original filename.
  const legacyFile = path.join(root, "documents", "legacy.md");
  const legacyText = "# 旧格式笔记\n\n不带 front matter。\n";
  await fs.writeFile(legacyFile, legacyText);
  const legacy = (await repository.list()).documents.find(doc => doc.title === "legacy");
  assert(legacy);
  const legacyCurrent = await repository.save({ ...legacy, body: "新版正文。\n" });
  const legacyEntries = await repository.listHistory(legacy.id);
  assert.equal(legacyEntries.length, 1);
  assert.equal((await repository.readHistory(legacy.id, legacyEntries[0].key)).body, legacyText);
  assert.equal((await repository.restoreHistory(legacy.id, legacyEntries[0].key, legacyCurrent.revision)).body, legacyText);
  checks.legacyMarkdownCompatible = true;

  // History preview may read an asset removed from the current body after restart.
  const pictureDoc = await repository.create({ title: "历史图片", category: "未分类", body: "初始。\n" });
  const png = await fs.readFile(new URL("../public/icons/icon-192.png", import.meta.url));
  const image = await repository.importDocumentImage(pictureDoc.id, png);
  const withPicture = await repository.save({ ...pictureDoc, body: `![历史图](${image.src})\n` });
  await repository.save({ ...withPicture, body: "当前已移除图片。\n" });
  restarted = new Repository(root); await restarted.init();
  await assert.rejects(restarted.readDocumentImage(pictureDoc.id, image.src), { code: "IMAGE_REFERENCE" });
  const pictureEntry = (await restarted.listHistory(pictureDoc.id)).find(entry => entry.revision === withPicture.revision);
  assert(pictureEntry);
  await restarted.readHistory(pictureDoc.id, pictureEntry.key);
  assert.equal(await restarted.readDocumentImage(pictureDoc.id, image.src), image.dataUrl);
  checks.historyImageAuthorization = true;

  // The UI's copy action writes the selected Markdown to a new document. Its
  // own saved references authorize reads, even with a fresh repository session.
  const pictureVersion = await restarted.readHistory(pictureDoc.id, pictureEntry.key);
  const pictureCopy = await restarted.create({ title: "历史图片（历史副本）", category: pictureVersion.category, body: pictureVersion.body });
  assert.notEqual(pictureCopy.id, pictureDoc.id);
  restarted.close(); restarted = new Repository(root); await restarted.init();
  assert.equal((await restarted.read(pictureCopy.id)).body, pictureVersion.body);
  assert.equal(await restarted.readDocumentImage(pictureCopy.id, image.src), image.dataUrl);
  await assert.rejects(restarted.readDocumentImage(other.id, image.src), { code: "IMAGE_REFERENCE" });
  const editedCopy = await restarted.save({ ...pictureCopy, body: pictureCopy.body + "\n副本继续编辑。\n" });
  assert.equal(await restarted.readDocumentImage(editedCopy.id, image.src), image.dataUrl);
  assert(!(await restarted.read(pictureDoc.id)).body.includes(image.src), "copy leaves the original current body unchanged");
  checks.historyCopyImagesAndIndependentAuthorization = true;

  const coverDoc = await restarted.create({ title: "历史模型图片", category: "未分类", body: "模型盖板测试。\n" });
  const withCover = await restarted.setModelImage(coverDoc.id, coverDoc.revision, png);
  const withoutCover = await restarted.removeModelImage(coverDoc.id, withCover.revision);
  const coverEntry = (await restarted.listHistory(coverDoc.id)).find(entry => entry.revision === withCover.revision);
  assert(coverEntry);
  const restoredCover = await restarted.restoreHistory(coverDoc.id, coverEntry.key, withoutCover.revision);
  assert.equal(restoredCover.modelImage, withCover.modelImage);
  assert.equal(await restarted.readModelImage(coverDoc.id, restoredCover.modelImage), `data:image/png;base64,${png.toString("base64")}`);
  checks.restoreHistoricalModelImage = true;

  // Exercise the existing ancestor symlink protection against the history path.
  const actualBackups = path.join(root, "backups-original");
  await fs.rename(backups, actualBackups);
  try {
    await fs.symlink(actualBackups, backups, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(repository.listHistory(first.id), { code: "SYMLINK" });
    await assert.rejects(repository.readHistory(first.id, firstEntry.key), { code: "SYMLINK" });
    checks.historyFolderSymlinkRejected = true;
  } finally {
    const stat = await fs.lstat(backups).catch(() => null);
    if (stat?.isSymbolicLink()) await fs.unlink(backups);
    await fs.rename(actualBackups, backups);
  }
  const historyAfterRestart = await restarted.listHistory(legacy.id);
  assert(historyAfterRestart.length >= 2);
  checks.restartPreservesHistory = true;
  const evidence = path.resolve("verification/research"); await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, "history-backend.json"), JSON.stringify({ checks }, null, 2));
  console.log("History: recovery, current/snapshot conflicts, scoped keys, invalid backups, legacy Markdown, image access/copy, model-image restore, junction rejection and restart passed.");
} finally { repository.close(); restarted?.close(); }
