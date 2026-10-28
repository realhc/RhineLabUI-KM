import { _electron as electron } from "playwright";
import { cp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const out = resolve("verification/p1"),
  run = resolve("release/p1-workflow", Date.now().toString()),
  portable = join(run, "portable");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes("RhineLabData"),
});
const launch = () =>
  electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: ["--user-data-dir=" + join(run, "profile")],
    timeout: 60000,
  });
let app, p;
const errors = [];
const checks = {};
async function poll(fn, arg) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await p.evaluate(fn, arg)) return;
    await p.waitForTimeout(80);
  }
  throw Error("State timeout: " + fn);
}
const read = (id) => p.evaluate((id) => window.rhine.read(id), id);
async function enter() {
  app = await launch();
  p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(e.message));
  await poll(() => window.rhineReview?.stats().ready);
  await p.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await p.evaluate(() => window.rhineReview.archive());
  await p.waitForTimeout(1200);
  await p.locator("[data-action=search]").click();
  await poll(() => document.querySelector("#library-overlay")?.open);
}
async function select(title) {
  await p.locator("#search").fill(title);
  const id = (await p.evaluate(() => window.rhine.list())).documents.find(
    (d) => d.title === title,
  ).id;
  await p.locator('[data-id="' + id + '"]').click();
  await poll(
    (title) => document.querySelector("#title").value === title,
    title,
  );
}
async function edit(text) {
  if ((await p.locator("#save").innerText()) === "编辑")
    await p.locator("#save").click();
  await p.locator("#preview .tiptap").fill(text);
}
async function saved() {
  await poll(
    () =>
      !document.querySelector("#save").disabled &&
      document.querySelector("#state").textContent.includes("已保存"),
  );
}
async function external(id, oldBody, newBody) {
  const file = join(portable, "RhineLabData", "documents", id + ".md");
  const raw = await readFile(file, "utf8");
  assert(raw.includes(oldBody));
  await writeFile(
    file,
    raw.replace(oldBody, () => newBody),
  );
  await poll(() =>
    document.querySelector("#notice").textContent.includes("外部修改"),
  );
}
async function interceptClose(choice) {
  await app.evaluate(({ dialog }, choice) => {
    globalThis.p1CloseChoice = choice;
    globalThis.p1Prompts = [];
    dialog.showMessageBoxSync = (_win, options) => {
      globalThis.p1Prompts.push(options);
      return globalThis.p1CloseChoice;
    };
  }, choice);
}
async function closeWindow() {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
}
let first, second, category;
try {
  await enter();
  ({ first, second, category } = await p.evaluate(async () => {
    const c = await window.rhine.createCategory("P1工作流");
    const a = await window.rhine.create({
      title: "P1草稿",
      category: c.name,
      categoryId: c.id,
      body: "Original disk body",
    });
    const b = await window.rhine.create({
      title: "P1另篇",
      category: c.name,
      categoryId: c.id,
      body: "Second body",
    });
    return { first: a, second: b, category: c };
  }));
  await select(first.title);
  await edit("Local draft copy");
  await external(first.id, first.body, "External disk copy");
  assert.equal(
    (await p.locator("#preview .tiptap").innerText()).trim(),
    "Local draft copy",
  );
  await p.keyboard.press("Control+s");
  await p.locator("[data-choice=cancel]").click();
  assert.equal((await read(first.id)).body, "External disk copy");
  await p.keyboard.press("Control+s");
  await p.locator("[data-choice=copy]").click();
  await saved();
  const copy = (await p.evaluate(() => window.rhine.list())).documents.find(
    (d) => d.title === first.title + "（冲突副本）",
  );
  assert(copy);
  assert.equal(copy.body, "Local draft copy");
  assert.equal((await read(first.id)).body, "External disk copy");
  checks.externalConflictCopyAndCancel = true;
  await select(first.title);
  await edit("Draft to discard");
  await external(first.id, "External disk copy", "External disk reload");
  await p.keyboard.press("Control+s");
  await p.locator("[data-choice=reload]").click();
  await saved();
  assert.equal(
    (await p.locator("#preview .tiptap").innerText()).trim(),
    "External disk reload",
  );
  checks.externalConflictReload = true;
  const deleted = await p.evaluate(() =>
    window.rhine.create({
      title: "P1删除测试",
      category: "未分类",
      body: "Delete disk body",
    }),
  );
  await select(deleted.title);
  await edit("Draft after external deletion");
  await unlink(join(portable, "RhineLabData", "documents", deleted.id + ".md"));
  await p.keyboard.press("Control+s");
  await p.locator("[data-choice=copy]").click();
  await saved();
  const deletionCopy = (
    await p.evaluate(() => window.rhine.list())
  ).documents.find((d) => d.title === deleted.title + "（冲突副本）");
  assert.equal(deletionCopy.body, "Draft after external deletion");
  checks.externalDeletionCopy = true;
  await select(first.title);

  await edit("Draft blocks reorder");
  await p.locator("#search").fill("P1");
  const before = (await p.evaluate(() => window.rhine.list())).documents.map(
    (d) => [d.id, d.order],
  );
  await p
    .locator('[data-id="' + second.id + '"] .directory-label')
    .dragTo(p.locator('[data-id="' + first.id + '"]'));
  await p.locator("[data-choice=cancel]").click();
  assert.deepEqual(
    (await p.evaluate(() => window.rhine.list())).documents.map((d) => [
      d.id,
      d.order,
    ]),
    before,
  );
  assert.equal(
    (await p.locator("#preview .tiptap").innerText()).trim(),
    "Draft blocks reorder",
  );
  await p
    .locator('[data-id="' + second.id + '"] .directory-label')
    .dragTo(p.locator('[data-id="' + first.id + '"]'));
  await p.locator("[data-choice=save]").click();
  await poll(
    async ([a, b]) => {
      const docs = (await window.rhine.list()).documents;
      return (
        docs.find((d) => d.id === a).order < docs.find((d) => d.id === b).order
      );
    },
    [second.id, first.id],
  );
  assert.equal((await read(first.id)).body, "Draft blocks reorder");
  checks.dirtyReorderCancelAndSave = true;
  const sceneBefore = await p.evaluate(
    () => window.rhineReview.stats().selected,
  );
  await p.locator("#preview .tiptap").focus();
  for (const key of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Enter",
    "/",
    "e",
  ])
    await p.keyboard.press(key);
  assert.equal(
    await p.evaluate(() => window.rhineReview.stats().selected),
    sceneBefore,
  );
  await p.keyboard.press("Control+f");
  assert.equal(await p.evaluate(() => document.activeElement.id), "search");
  checks.keyboardIsolation = true;
  await edit("Saved before quitting");
  await interceptClose(0);
  await closeWindow();
  await p.waitForTimeout(200);
  assert.equal(p.isClosed(), false);
  const prompts = await app.evaluate(() => globalThis.p1Prompts);
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].buttons, ["继续编辑", "放弃修改并退出"]);
  assert.equal(prompts[0].cancelId, 0);
  assert.equal(
    (await p.locator("#preview .tiptap").innerText()).trim(),
    "Saved before quitting",
  );
  await p.keyboard.press("Control+s");
  await saved();
  assert.equal((await read(first.id)).body, "Saved before quitting");
  const cleanClosing = p.waitForEvent("close");
  await closeWindow();
  await cleanClosing;
  await app.close().catch(() => {});
  checks.closeCancelThenSave = true;
  await enter();
  assert.equal((await read(first.id)).body, "Saved before quitting");
  let docs = (await p.evaluate(() => window.rhine.list())).documents;
  assert(
    docs.find((d) => d.id === second.id).order <
      docs.find((d) => d.id === first.id).order,
  );
  assert.equal(docs.find((d) => d.id === first.id).categoryId, category.id);
  checks.restartStableIdsAndOrder = true;
  await select(first.title);
  await edit("Discard on application exit");
  await interceptClose(1);
  const closing = p.waitForEvent("close");
  await closeWindow();
  await closing;
  await app.close().catch(() => {});
  await enter();
  assert.equal((await read(first.id)).body, "Saved before quitting");
  checks.closeDiscardDoesNotWrite = true;
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "workflow-result.json"),
    JSON.stringify({ checks, errors }, null, 2) + "\n",
  );
  console.log(JSON.stringify(checks));
} catch (e) {
  console.error(e);
  await p
    ?.screenshot({ path: join(out, "workflow-failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    )
    .catch(() => {});
  await app?.close().catch(() => {});
}
