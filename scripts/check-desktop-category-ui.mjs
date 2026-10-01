import { _electron as electron } from "playwright";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const out = resolve("verification/category-directory"),
  run = resolve("release/category-test", Date.now().toString()),
  portable = join(run, "portable");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: source => !source.split(/[\/]/).includes("RhineLabData"),
});
const launch = () =>
  electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: ["--user-data-dir=" + join(run, "profile")],
    timeout: 60000,
  });
let app = await launch();
let firstId, secondId, documentId;
const errors = [];
async function poll(page,fn,arg,options={}) {const deadline=Date.now()+(options.timeout??30000);do{if(await page.evaluate(fn,arg))return;await page.waitForTimeout(80);}while(Date.now()<deadline);throw new Error('Timed out waiting for completed category operation');}
async function enter(page) {
  await poll(page,() => window.rhineReview?.stats().ready, null, {
    timeout: 60000,
  });
  await page.locator(".entry-start").click();
  await poll(page,
    () => window.rhineReview.stats().startup === "started",
  );
  await page.evaluate(() => window.rhineReview.archive());
  await page.waitForTimeout(2400);
  await page.locator('[data-action="search"]').click();
  await poll(page,
    () => document.querySelector("#library-overlay").open,
  );
}
try {
  const p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await enter(p);
  assert.equal(await p.locator("#filter").count(), 0);
  async function add(kind, name) {
    await p.locator("#new").click();
    await p.locator("#new-" + kind).click();
    await p.locator("#directory-name").fill(name);
    await p.locator('[data-choice="confirm"]').click();
    await poll(p,
      async ([kind, name]) => {
        const d = await window.rhine.list();
        return (kind === "category" ? d.categories : d.documents).some(
          (x) => (x.name ?? x.title) === name,
        );
      },
      [kind, name],
    );
  }
  await add("category", "用户指南");
  firstId = await p.evaluate(
    async () =>
      (await window.rhine.list()).categories.find((c) => c.name === "用户指南")
        .id,
  );
  await p.locator(`[data-category-id="${firstId}"] .category-toggle`).click();
  await add("document", "入门说明");
  await poll(p,()=>!document.querySelector("#new").disabled && document.querySelector("#title").value==="入门说明");
  let data = await p.evaluate(() => window.rhine.list());
  const doc = data.documents.find((d) => d.title === "入门说明");
  documentId = doc.id;
  assert.equal(doc.categoryId, firstId);
  assert.equal(await p.locator(`[data-id="${documentId}"]`).isVisible(), true);
  await p.locator("#preview .tiptap").fill("# 入门说明\n\n分类大刻度与文档小刻度。");
  await p.locator("#save").click();
  await poll(p,() =>
    document.querySelector("#state").textContent.includes("已保存"),
  );
  await add("category", "研究笔记");
  secondId = await p.evaluate(
    async () =>
      (await window.rhine.list()).categories.find((c) => c.name === "研究笔记")
        .id,
  );
  await p
    .locator('[data-id="' + documentId + '"]')
    .dragTo(p.locator('[data-category-id="' + secondId + '"]'));
  await poll(p,
    async ([doc, category]) =>
      (await window.rhine.list()).documents.find((d) => d.id === doc)
        .categoryId === category,
    [documentId, secondId],
  );
  await poll(p, id => !document.querySelector(`[data-category-id="${id}"] .category-toggle`).hasAttribute("data-empty"), secondId);
  await p
    .locator('[data-category-id="' + secondId + '"] .category-toggle')
    .click();
  assert.equal(await p.locator('[data-id="' + documentId + '"]').count(), 0);
  assert.ok(
    (await p.evaluate(() => window.rhine.list())).documents.some(
      (d) => d.id === documentId,
    ),
  );
  await p
    .locator('[data-category-id="' + secondId + '"] .category-toggle')
    .click();
  await p.locator('[data-id="' + documentId + '"]').click();
  await p
    .locator(
      '[data-category-id="' + secondId + '"] [data-category-action="rename"]',
    )
    .click();
  await p.locator("#directory-name").fill("实验记录");
  await p.locator('[data-choice="confirm"]').click();
  await poll(p,
    async (id) =>
      (await window.rhine.list()).categories.find((c) => c.id === id).name ===
      "实验记录",
    secondId,
  );
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(out, "hierarchy-light.png") });
  await p.locator("#library-close").click();
  await p.locator('[data-action="settings"]').click();
  await p.locator('[data-color-theme="dark"]').click();
  await p.waitForTimeout(600);
  await p.locator('[data-action="close-modal"]').click();
  await p.waitForTimeout(300);
  await p.locator('[data-action="search"]').click();
  await p.locator('[data-id="' + documentId + '"]').click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1000, 680),
  );
  await p.waitForTimeout(300);
  await p.locator(`[data-category-id="${secondId}"]`).scrollIntoViewIfNeeded();
  await p.locator(`[data-id="${documentId}"]`).scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(out, "hierarchy-dark-small.png") });
  await p.locator("#library-close").click();
  await poll(p,
    () =>
      window.rhineReview.stats().selected ===
        document.querySelector("#selected-title").textContent ||
      !document.querySelector("#library-overlay").open,
  );
  await p.waitForTimeout(600);
  assert.match(await p.locator("#column-name").innerText(), /^实验记录/);
  assert.equal(
    await p.evaluate(() => window.rhineReview.stats().selected),
    documentId,
  );
  await p.locator('[data-action="search"]').click();
  await p
    .locator(
      '[data-category-id="' + secondId + '"] [data-category-action="remove"]',
    )
    .click();
  await p.locator('[data-choice="remove-category"]').click();
  await poll(p,
    async (id) =>
      !(await window.rhine.list()).categories.some((c) => c.id === id),
    secondId,
  );
  assert.equal(
    (await p.evaluate(() => window.rhine.list())).documents.find(
      (d) => d.id === documentId,
    ).categoryId,
    null,
  );
  await p.locator('[data-id="' + documentId + '"]').click();
  assert.match(await p.locator("#preview .tiptap").innerText(), /分类大刻度/);
  await p.locator("#remove").click();
  await p.locator('[data-choice="delete"]').click();
  await poll(p,
    async (id) => (await window.rhine.list()).trash.some((d) => d.id === id),
    documentId,
  );
  assert.ok(
    (await p.evaluate(() => window.rhine.list())).categories.some(
      (c) => c.id === firstId,
    ),
  );
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  again.on("pageerror", (e) => errors.push(e.message));
  await enter(again);
  data = await again.evaluate(() => window.rhine.list());
  assert.ok(data.categories.some((c) => c.id === firstId));
  assert.equal(
    data.categories.some((c) => c.id === secondId),
    false,
  );
  assert.ok(data.trash.some((d) => d.id === documentId));
  await again.evaluate(async () => {
    const data = await window.rhine.list();
    for (const c of data.categories) await window.rhine.removeCategory(c.id);
    for (const d of data.documents) await window.rhine.trash(d.id, d.revision);
  });
  await again.locator("#refresh").click();
  await poll(again,
    () => document.querySelectorAll("#documents .document").length === 0,
  );
  await again.locator("#library-close").click();
  await again.waitForTimeout(800);
  const stats = await again.evaluate(() => window.rhineReview.stats());
  assert.ok(stats.ready && stats.loaded && stats.triangles > 0);
  await again.screenshot({ path: join(out, "empty-array.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "ui-result.json"),
    JSON.stringify(
      {
        createNamedCategory: true,
        createNamedDocument: true,
        dragIntoCategory: true,
        collapse: true,
        rename: true,
        columnMapping: true,
        independentCategoryRemoval: true,
        independentDocumentRemoval: true,
        restart: true,
        emptyArrayStillRendered: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Category directory UI and empty-array rendering passed");
} finally {
  await app.close();
}
