import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repository } from "../desktop/repository.mjs";
import {
  records,
  archiveColumns,
  setDesktopDocuments,
  columnFiles,
  fileLocation,
  exhibitDocument,
  documentForRecord,
} from "../src/desktop-data.ts";
const samples = JSON.parse(readFileSync("content/archives.json", "utf8")),
  root = await fs.mkdtemp(path.join(os.tmpdir(), "rhine-categories-"));
let repo = new Repository(root, samples.records, samples.columns);
try {
  let data = await repo.init();
  assert.equal(data.categories.length, 5);
  setDesktopDocuments(data.documents, data.categories, data.nextLane);
  assert.deepEqual(records, samples.records);
  assert.deepEqual(archiveColumns, samples.columns);
  const alpha = await repo.createCategory("Alpha"),
    beta = await repo.createCategory("Beta");
  let doc = await repo.create({
    title: "Category document",
    category: "Alpha",
    categoryId: alpha.id,
    body: "# Body preserved",
  });
  assert.equal(doc.categoryId, alpha.id);
  await assert.rejects(
    repo.create({
      title: "Invalid category doc",
      category: "Bad",
      categoryId: "missing",
      body: "",
    }),
    { code: "NOT_FOUND" },
  );
  assert.ok(
    !(await repo.list()).documents.some(
      (d) => d.title === "Invalid category doc",
    ),
  );
  await repo.moveDocument(doc.id, beta.id);
  doc = await repo.read(doc.id);
  assert.equal(doc.categoryId, beta.id);
  assert.equal(doc.body, "# Body preserved");
  const revision = doc.revision;
  await repo.renameCategory(beta.id, "Beta renamed");
  doc = await repo.read(doc.id);
  assert.equal(doc.category, "Beta renamed");
  assert.equal(
    doc.revision,
    revision,
    "renaming category does not rewrite documents",
  );
  await repo.removeCategory(beta.id);
  doc = await repo.read(doc.id);
  assert.equal(doc.categoryId, null);
  assert.equal(doc.body, "# Body preserved");
  assert.equal(
    doc.revision,
    revision,
    "removing category preserves document bytes",
  );
  let empty = await repo.list();
  assert.ok(
    empty.categories.some((c) => c.id === alpha.id),
    "empty categories persist",
  );
  await repo.moveDocument(doc.id, alpha.id);
  doc = await repo.read(doc.id);
  await repo.trash(doc.id, doc.revision);
  assert.ok(
    (await repo.list()).categories.some((c) => c.id === alpha.id),
    "document removal retains category",
  );
  await repo.removeCategory(alpha.id);
  await repo.restore(doc.id);
  assert.equal(
    (await repo.read(doc.id)).categoryId,
    null,
    "trash and restore cannot resurrect a removed category",
  );
  const groups = [];
  for (let i = 0; i < 7; i++)
    groups.push(await repo.createCategory("Extra " + i));
  for (let i = 0; i < 35; i++)
    await repo.create({
      title: "Ordered " + i,
      category: groups[6].name,
      categoryId: groups[6].id,
      body: String(i),
    });
  data = await repo.list();
  setDesktopDocuments(data.documents, data.categories, data.nextLane);
  const lane = groups[6].lane,
    files = columnFiles(lane);
  assert.equal(files.length, 35);
  for (let i = 0; i < 35; i++) {
    assert.equal(documentForRecord(files[i]).title, "Ordered " + i);
    assert.equal(fileLocation(files[i]).lane, lane);
    assert.equal(fileLocation(files[i]).row, 12 + i);
  }
  assert.ok(exhibitDocument(doc.id) >= 0);
  assert.equal(archiveColumns[lane], groups[6].name);
  repo.close();
  repo = new Repository(root, samples.records, samples.columns);
  data = await repo.init();
  assert.ok(data.categories.some((c) => c.id === groups[6].id));
  assert.equal(
    data.documents.filter((d) => d.categoryId === groups[6].id).length,
    35,
  );
  for (const c of data.categories) await repo.removeCategory(c.id);
  data = await repo.list();
  assert.equal(data.categories.length, 0);
  assert.equal(data.documents.length, 76);
  for (const d of data.documents) await repo.trash(d.id, d.revision);
  data = await repo.list();
  setDesktopDocuments(data.documents, data.categories, data.nextLane);
  assert.ok(records.length >= 40);
  assert.ok(archiveColumns.length >= 5);
  assert.ok(columnFiles(0).length >= 8);
  assert.equal(documentForRecord(0), undefined);
  console.log(
    "Categories: migration, independent CRUD, empty groups, invalid IDs, trash/restore, 7+ categories, 35 documents per column, stable mapping, restart and empty-array scaffolding passed.",
  );
} finally {
  repo.close();
  await fs.rm(root, { recursive: true, force: true });
}
