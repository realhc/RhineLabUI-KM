import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../desktop/repository.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "rhine-repository-"));
const root = path.join(temporary, "RhineLabData");
let repository = new Repository(root);
let listingRepo;
const input = {
  title: '第一篇 : "引号"',
  category: "测试",
  body: "# Heading\r\n\r\n中文正文\n---\nTrailing spaces  \n",
};
try {
  await repository.init();
  const first = await repository.create(input);
  assert.equal(
    (await repository.read(first.id)).body,
    input.body,
    "Markdown byte content must round trip",
  );
  const second = await repository.create({ ...input, title: "第二篇" });
  await assert.rejects(repository.create(input), { code: "DUPLICATE_TITLE" });
  await assert.rejects(repository.save({ ...second, title: first.title }), {
    code: "DUPLICATE_TITLE",
  });
  await assert.rejects(repository.create(null), { code: "INPUT" });
  await assert.rejects(repository.save({ ...first, revision: {} }), {
    code: "INPUT",
  });
  await assert.rejects(repository.read(first.id, "false"), { code: "INPUT" });
  await repository.reorder([second.id, first.id]);
  repository.close();
  repository = new Repository(root);
  await repository.init();
  assert.deepEqual(
    (await repository.list()).documents.map((item) => item.id),
    [second.id, first.id],
    "order survives restart",
  );

  let current = await repository.read(first.id);
  current = await repository.save({ ...current, body: "Edited\n" });
  assert.equal((await repository.read(first.id)).body, "Edited\n");
  assert.ok(
    (await fs.readdir(path.join(root, "backups"))).length >= 2,
    "writes keep backup versions",
  );
  const target = path.join(root, "documents", `${first.id}.md`);
  await fs.appendFile(target, "\nExternal edit");
  await assert.rejects(repository.save({ ...current, body: "Overwrite" }), {
    code: "CONFLICT",
  });
  await assert.rejects(repository.trash(first.id, current.revision), {
    code: "CONFLICT",
  });
  assert.match((await repository.read(first.id)).body, /External edit/);

  current = await repository.read(first.id);
  const original = await fs.readFile(target, "utf8");
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if (destination === target)
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(
      repository.save({ ...current, body: "Cannot persist" }),
      { code: "ENOSPC" },
    );
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(
    await fs.readFile(target, "utf8"),
    original,
    "failed atomic replacement preserves original",
  );
  assert.ok(
    !(await fs.readdir(path.join(root, "documents"))).some((file) =>
      file.endsWith(".tmp"),
    ),
    "failed writes clean temporary files",
  );
  const originalOpen = fs.open;
  fs.open = async (file, ...args) => {
    if (String(file).endsWith(".tmp"))
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    return originalOpen(file, ...args);
  };
  try {
    await assert.rejects(
      repository.create({ ...input, title: "Permission failure" }),
      { code: "EACCES" },
    );
  } finally {
    fs.open = originalOpen;
  }
  fs.open = async (file, ...args) => {
    if (String(file).endsWith(".tmp"))
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    return originalOpen(file, ...args);
  };
  try {
    await assert.rejects(
      new Repository(root).init(),
      (error) =>
        error.code === "EACCES" && error.message.includes("用户可写文件夹"),
      "existing read-only libraries fail with migration guidance",
    );
  } finally {
    fs.open = originalOpen;
  }

  await repository.trash(first.id, current.revision);
  assert.equal((await repository.list()).trash.length, 1);
  await assert.rejects(repository.read(first.id), { code: "NOT_FOUND" });
  await repository.restore(first.id);
  assert.equal((await repository.read(first.id)).body, current.body);
  const restored = await repository.read(first.id);
  await repository.trash(first.id, restored.revision);
  await repository.purge(first.id);
  assert.equal((await repository.list()).trash.length, 0);

  const crashDoc = await repository.create({
    ...input,
    title: "Crash recovery",
  });
  const crashSource = path.join(root, "documents", `${crashDoc.id}.md`);
  const originalUnlink = fs.unlink;
  fs.unlink = async (file) => {
    if (file === crashSource)
      throw Object.assign(
        new Error("simulated crash after destination commit"),
        { code: "EIO" },
      );
    return originalUnlink(file);
  };
  try {
    await assert.rejects(repository.trash(crashDoc.id, crashDoc.revision), {
      code: "EIO",
    });
  } finally {
    fs.unlink = originalUnlink;
  }
  await new Repository(root).init();
  assert.equal(
    (await repository.read(crashDoc.id, true)).body,
    input.body,
    "restart completes interrupted move without duplicate IDs",
  );
  await assert.rejects(fs.access(path.join(root, ".move.json")), {
    code: "ENOENT",
  });
  await repository.restore(crashDoc.id);
  const crashCurrent = await repository.read(crashDoc.id);
  const crashDestination = path.join(root, ".trash", `${crashDoc.id}.md`);
  fs.rename = async (source, destination) => {
    if (destination === crashDestination)
      throw Object.assign(new Error("simulated failed destination commit"), {
        code: "ENOSPC",
      });
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(repository.trash(crashDoc.id, crashCurrent.revision), {
      code: "ENOSPC",
    });
  } finally {
    fs.rename = originalRename;
  }
  await new Repository(root).init();
  assert.equal(
    (await repository.read(crashDoc.id)).body,
    input.body,
    "restart retains source when destination never commits",
  );

  const blockedDoc = await repository.create({
    ...input,
    title: "Occupied move destination",
  });
  const blockedDestination = path.join(root, ".trash", blockedDoc.id + ".md");
  const unrelatedBytes =
    '---\nid: invalid\ntitle: "unclosed\n---\nExternal file must survive';
  await fs.writeFile(blockedDestination, unrelatedBytes);
  await assert.rejects(repository.trash(blockedDoc.id, blockedDoc.revision), {
    code: "CONFLICT",
  });
  assert.equal(await fs.readFile(blockedDestination, "utf8"), unrelatedBytes);
  await assert.rejects(fs.access(path.join(root, ".move.json")), {
    code: "ENOENT",
  });
  await new Repository(root).init();
  assert.equal(
    (await repository.read(blockedDoc.id)).body,
    input.body,
    "occupied destination does not wedge startup",
  );
  await fs.unlink(blockedDestination);
  // An external writer can also create the destination after the preflight.
  const originalAtomic = repository.atomic.bind(repository);
  repository.atomic = async (file, ...args) => {
    if (file === blockedDestination) await fs.writeFile(file, unrelatedBytes);
    return originalAtomic(file, ...args);
  };
  try {
    await assert.rejects(repository.trash(blockedDoc.id, blockedDoc.revision), {
      code: "CONFLICT",
    });
  } finally {
    repository.atomic = originalAtomic;
  }
  assert.equal(
    await fs.readFile(blockedDestination, "utf8"),
    unrelatedBytes,
    "concurrent destination is never deleted",
  );
  await assert.rejects(fs.access(path.join(root, ".move.json")), {
    code: "ENOENT",
  });
  await new Repository(root).init();
  await fs.unlink(blockedDestination);
  await repository.trash(blockedDoc.id, blockedDoc.revision);
  await repository.restore(blockedDoc.id);

  const concurrentRoot = path.join(temporary, "concurrent-move");
  const concurrentRepo = new Repository(concurrentRoot);
  await concurrentRepo.init();
  const concurrentDoc = await concurrentRepo.create({
    ...input,
    title: "Concurrent external edits",
  });
  const concurrentSource = path.join(
    concurrentRoot,
    "documents",
    concurrentDoc.id + ".md",
  );
  const concurrentDestination = path.join(
    concurrentRoot,
    ".trash",
    concurrentDoc.id + ".md",
  );
  const concurrentAtomic = concurrentRepo.atomic.bind(concurrentRepo);
  concurrentRepo.atomic = async (file, ...args) => {
    await concurrentAtomic(file, ...args);
    if (file === concurrentDestination) {
      await fs.appendFile(concurrentSource, "\nExternal source edit");
      await fs.appendFile(concurrentDestination, "\nExternal destination edit");
    }
  };
  await assert.rejects(
    concurrentRepo.trash(concurrentDoc.id, concurrentDoc.revision),
    { code: "CONFLICT" },
  );
  assert.match(
    await fs.readFile(concurrentSource, "utf8"),
    /External source edit/,
  );
  assert.match(
    await fs.readFile(concurrentDestination, "utf8"),
    /External destination edit/,
    "rollback never deletes an externally modified destination",
  );
  await fs.access(path.join(concurrentRoot, ".move.json"));

  const external = path.join(root, "documents", "外部笔记.md");
  await fs.writeFile(external, "# 外部文档\n\nraw content\n");
  let externalDoc = (await repository.list()).documents.find(
    (doc) => doc.title === "外部笔记",
  );
  assert.ok(externalDoc);
  externalDoc = await repository.save({
    ...externalDoc,
    title: "外部笔记已更新",
  });
  assert.match(await fs.readFile(external, "utf8"), /^---\nid:/);
  assert.equal((await repository.read(externalDoc.id)).title, "外部笔记已更新");
  await fs.copyFile(external, path.join(root, "documents", "duplicate.md"));
  assert.ok(
    (await repository.list()).issues.some(
      (issue) => issue.code === "DUPLICATE",
    ),
  );
  await assert.rejects(repository.read(externalDoc.id), { code: "NOT_FOUND" });
  await fs.unlink(path.join(root, "documents", "duplicate.md"));
  await fs.writeFile(
    path.join(root, "documents", "broken.md"),
    '---\nid: bad\ntitle: "unclosed\n---\nbody',
  );
  assert.ok(
    (await repository.list()).issues.some((issue) => issue.code === "FORMAT"),
  );
  await assert.rejects(repository.read("../escape"), { code: "INVALID_ID" });
  await assert.rejects(repository.read("CON"), { code: "INVALID_ID" });
  await assert.rejects(repository.reorder([second.id, second.id]), {
    code: "INPUT",
  });

  const watched = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("filesystem watcher timed out")),
      5000,
    );
    repository.watch(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await fs.appendFile(external, "watch notification");
  await watched;
  repository.close();

  const outside = path.join(temporary, "outside");
  await fs.mkdir(outside);
  const linkRoot = path.join(temporary, "linked-library");
  await fs.symlink(
    outside,
    linkRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(new Repository(linkRoot).init(), { code: "SYMLINK" });
  await fs.symlink(
    outside,
    path.join(root, "documents", "link.md"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.ok(
    (await repository.list()).issues.some((issue) => issue.code === "SYMLINK"),
  );

  // Array and editor refresh together: one disk scan, independent results.
  const listingRoot = path.join(temporary, "concurrent-list");
  listingRepo = new Repository(listingRoot);
  await listingRepo.init();
  const listingDoc = await listingRepo.create({
    ...input,
    title: "Concurrent listing",
  });
  const scanListing = listingRepo.scan.bind(listingRepo);
  let scans = 0,
    entered,
    release;
  let ready = new Promise((resolve) => (entered = resolve));
  let gate = new Promise((resolve) => (release = resolve));
  listingRepo.scan = async () => {
    scans++;
    const result = await scanListing();
    entered();
    await gate;
    return result;
  };
  const requests = [listingRepo.list(), listingRepo.list(), listingRepo.list()];
  await ready;
  assert.equal(scans, 1, "simultaneous refreshes share one disk scan");
  release();
  const snapshots = await Promise.all(requests);
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.notEqual(snapshots[0], snapshots[1]);
  snapshots[0].documents[0].body = "caller-local change";
  assert.equal(
    snapshots[1].documents[0].body,
    input.body,
    "shared scans keep caller results isolated",
  );
  listingRepo.scan = scanListing;

  const listingFile = path.join(
    listingRoot,
    "documents",
    listingDoc.id + ".md",
  );
  const listingStat = await fs.stat(listingFile);
  const listingRaw = await fs.readFile(listingFile, "utf8");
  await fs.writeFile(listingFile, listingRaw.replace("Heading", "Changed"));
  await fs.utimes(listingFile, listingStat.atime, listingStat.mtime);
  let listed = (await listingRepo.list()).documents[0];
  assert.match(
    listed.body,
    /Changed/,
    "a completed scan never caches external file content",
  );
  assert.notEqual(
    listed.revision,
    listingDoc.revision,
    "same-size same-mtime edits get fresh content revisions",
  );

  scans = 0;
  listingRepo.scan = async () => {
    scans++;
    throw Object.assign(new Error("listing unavailable"), { code: "EIO" });
  };
  const failedLists = await Promise.allSettled([
    listingRepo.list(),
    listingRepo.list(),
  ]);
  assert.equal(scans, 1);
  assert.ok(
    failedLists.every(
      (result) => result.status === "rejected" && result.reason.code === "EIO",
    ),
  );
  listingRepo.scan = scanListing;
  assert.match(
    (await listingRepo.list()).documents[0].body,
    /Changed/,
    "a rejected scan does not poison later reads",
  );

  // A pending pre-save scan must not be reused by the save or its next refresh.
  scans = 0;
  ready = new Promise((resolve) => (entered = resolve));
  gate = new Promise((resolve) => (release = resolve));
  listingRepo.scan = async () => {
    const firstScan = ++scans === 1;
    const result = await scanListing();
    if (firstScan) {
      entered();
      await gate;
    }
    return result;
  };
  const beforeSave = listingRepo.list();
  await ready;
  await listingRepo.save({ ...listed, body: "Saved after pending scan" });
  assert.equal(
    (await listingRepo.list()).documents[0].body,
    "Saved after pending scan",
    "write transactions separate old and new scan results",
  );
  release();
  assert.match((await beforeSave).documents[0].body, /Changed/);
  listingRepo.scan = scanListing;
  // Watch events split a still-running snapshot from the next disk refresh.
  scans = 0;
  ready = new Promise((resolve) => (entered = resolve));
  gate = new Promise((resolve) => (release = resolve));
  listingRepo.scan = async () => {
    const firstScan = ++scans === 1;
    const result = await scanListing();
    if (firstScan) {
      entered();
      await gate;
    }
    return result;
  };
  const beforeExternal = listingRepo.list();
  await ready;
  const changedOnDisk = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("pending-list watcher timed out")),
      5000,
    );
    listingRepo.watch(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await fs.appendFile(listingFile, "\nExternal edit during scan");
  await changedOnDisk;
  assert.match(
    (await listingRepo.list()).documents[0].body,
    /External edit during scan/,
    "watch notification cuts off an unfinished old snapshot",
  );
  release();
  assert.equal(
    (await beforeExternal).documents[0].body,
    "Saved after pending scan",
  );
  listingRepo.scan = scanListing;
  listingRepo.close();

  const samples = JSON.parse(
    await fs.readFile(new URL("../content/archives.json", import.meta.url)),
  ).records;
  const sampleRoot = path.join(temporary, "samples");
  const seeded = new Repository(sampleRoot, samples);
  assert.equal((await seeded.init()).documents.length, 40);
  const initial = (await seeded.list()).documents[0];
  const initialSample = samples.find((sample) => sample.id === initial.id);
  for (const field of [
    "en",
    "department",
    "date",
    "lead",
    "clearance",
    "source",
  ])
    assert.ok(
      initial.body.includes(initialSample[field]),
      `sample preserves ${field}`,
    );
  await seeded.trash(initial.id, initial.revision);
  await seeded.purge(initial.id);
  assert.equal(
    (await new Repository(sampleRoot, samples).init()).documents.length,
    39,
    "sample import never repeats",
  );
  const occupiedRoot = path.join(temporary, "occupied");
  const occupied = new Repository(occupiedRoot);
  await occupied.init();
  await occupied.create(input);
  await fs.unlink(path.join(occupiedRoot, ".initialized"));
  assert.equal(
    (await new Repository(occupiedRoot, samples).init()).documents.length,
    1,
    "existing library is never seeded",
  );
  const proseSample = {
    ...samples[0],
    source: "原始资料汇编，含中文说明与空格",
  };
  const proseSeeded = await new Repository(
    path.join(temporary, "prose-source"),
    [proseSample],
  ).init();
  assert.ok(proseSeeded.documents[0].body.includes(proseSample.source));
  assert.ok(
    !proseSeeded.documents[0].body.includes(
      `[参考来源](${proseSample.source})`,
    ),
    "prose sources are not invalid Markdown URLs",
  );
  console.log(
    "Desktop repository: persistence, raw Markdown, conflicts, atomic failures, permissions/read-only probes, backups, journaled trash recovery, external indexing, duplicate IDs/titles, IPC argument validation, bad metadata, traversal, symlinks, watcher, concurrent refresh sharing, fresh external revisions, write boundaries and complete 40-sample migration passed.",
  );
} finally {
  listingRepo?.close();
  repository.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
