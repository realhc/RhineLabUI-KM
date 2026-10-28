import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const run = resolve("release/document-images-test/graph");
const evidence = resolve("verification/graph");
const portable = join(run, "portable");
const source = resolve(process.env.RHINE_TEST_PORTABLE || "release/packages/RhineLab-win32-x64");
const within = relative(resolve("release/document-images-test"), run);
assert(within && !within.startsWith("..") && !isAbsolute(within));
assert.notEqual(source, portable);
await mkdir(evidence, { recursive: true });
await mkdir(run, { recursive: true });
await cp(source, portable, { recursive: true, filter: file => !file.split(/[\\/]/).some(part => part.toLowerCase() === "rhinelabdata") });

let app, page;
const errors = [], requests = [], checks = {};
async function poll(test, arg, timeout = 90000) {
  const end = Date.now() + timeout;
  do {
    if (await page.evaluate(test, arg)) return;
    await page.waitForTimeout(80);
  } while (Date.now() < end);
  throw Error("Graph UI condition timed out: " + test);
}
async function launch() {
  app = await electron.launch({ executablePath: join(portable, "RhineLab.exe"), args: ["--user-data-dir=" + join(run, "profile")], timeout: 60000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^(?:https?|file):/i.test(request.url())) requests.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await poll(() => window.rhineReview?.stats().ready);
  if ((await page.evaluate(() => window.rhineReview.stats().startup)) !== "started") await page.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await page.evaluate(() => window.rhineReview.archive());
  await page.locator('[data-action="search"]').click();
  await poll(() => document.querySelector("#library-overlay")?.open && document.querySelector("#library-overlay")?.dataset.motionState === "open");
}
async function openDocument(doc) {
  if (!(await page.locator("#library-overlay").evaluate(element => element.open))) {
    await page.locator('[data-action="search"]').click();
    await poll(() => document.querySelector("#library-overlay")?.open);
  }
  await page.locator('[data-view="all"]').click();
  await page.locator("#search").fill(doc.title);
  await page.locator(`#documents [data-id="${doc.id}"]`).click();
  await poll(({ id }) => document.querySelector("#title")?.value === id.title && !document.querySelector("#editor")?.hidden, { id: doc });
}
async function selectText(text) {
  await page.locator("#preview .tiptap").evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      root.focus();
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + text.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw Error("Missing selected text: " + text);
  }, text);
  await page.waitForTimeout(100);
}
async function graphOpen() {
  await page.locator("#graph-open").click();
  await poll(() => document.querySelector("#graph-workspace")?.open);
}

try {
  await launch();
  const suffix = String(Date.now());
  const docs = await page.evaluate(async suffix => {
    const category = await window.rhine.createCategory("图谱验证 " + suffix);
    const create = (title, body) => window.rhine.create({ title: title + suffix, category: category.name, categoryId: category.id, body });
    const b = await create("图谱目标", "目标文档。\n");
    const c = await create("图谱孤点", "没有链接。\n");
    const a = await create("图谱来源", `GraphLeftGraphTargetGraphRight\n\n[外链](https://example.com/graph)\n\n\`\`\`markdown\n[代码里的链接](${b.id}.md)\n\`\`\`\n`);
    return { a, b, c };
  }, suffix);

  await openDocument(docs.a);
  await page.keyboard.press("e");
  await poll(() => document.querySelector("#preview .tiptap")?.contentEditable === "true");
  await selectText("GraphTarget");
  await page.locator('[data-command="link"]').click();
  await page.locator("#editor-document").selectOption(docs.b.id);
  await page.locator('[data-choice="confirm"]').click();
  await poll(id => !!document.querySelector(`#preview a[href="${id}.md"]`), docs.b.id);
  await selectText("GraphTarget");
  await page.locator('[data-command="link"]').click();
  assert.equal(await page.locator("#editor-document").inputValue(), docs.b.id);
  assert.equal(await page.locator("#editor-value").inputValue(), "");
  await page.locator("#editor-value").fill("https://example.com/replaced");
  assert.equal(await page.locator("#editor-document").inputValue(), "");
  await page.locator('[data-choice="confirm"]').click();
  await poll(() => !!document.querySelector('#preview a[href="https://example.com/replaced"]'));
  await selectText("GraphTarget");
  await page.locator('[data-command="link"]').click();
  await page.locator("#editor-document").selectOption(docs.b.id);
  assert.equal(await page.locator("#editor-value").inputValue(), "");
  await page.locator('[data-choice="confirm"]').click();
  await poll(id => !!document.querySelector(`#preview a[href="${id}.md"]`), docs.b.id);
  await page.keyboard.press("Control+s");
  await poll(async ({ source, target }) => (await window.rhine.read(source)).body.includes(`${target}.md`) && document.querySelector("#state")?.textContent?.includes("已保存"), { source: docs.a.id, target: docs.b.id });
  checks.insertAndSaveInternalLink = true;

  await graphOpen();
  const aNode = page.locator(`[data-graph-id="${docs.a.id}"]`);
  const bNode = page.locator(`[data-graph-id="${docs.b.id}"]`);
  const cNode = page.locator(`[data-graph-id="${docs.c.id}"]`);
  assert.equal(await aNode.count(), 1);
  assert.equal(await bNode.count(), 1);
  assert.equal(await cNode.count(), 1);
  assert.equal(await page.locator(`[data-graph-edge="${docs.a.id}:${docs.b.id}"]`).count(), 1);
  assert.equal(await page.locator(`[data-graph-edge="${docs.a.id}:${docs.c.id}"]`).count(), 0);
  await page.locator("#graph-orphans").uncheck();
  assert.equal(await cNode.count(), 0);
  await page.locator("#graph-orphans").check();
  await page.locator("#graph-search").fill(docs.a.title);
  assert.equal(await aNode.evaluate(element => element.classList.contains("graph-match")), true);
  await page.locator("#graph-search").fill("");
  const transform = page.locator("#graph-canvas .graph-transform");
  const beforeZoom = await transform.getAttribute("transform");
  await page.locator("#graph-canvas").hover({ position: { x: 400, y: 280 } });
  await page.mouse.wheel(0, -420);
  await poll(value => document.querySelector("#graph-canvas .graph-transform")?.getAttribute("transform") !== value, beforeZoom);
  await page.locator("#graph-fit").click();
  await page.screenshot({ path: join(evidence, "graph.png") });
  checks.nodesEdgesFiltersAndZoom = true;

  await bNode.click();
  await poll(title => document.querySelector("#title")?.value === title && !document.querySelector("#graph-workspace")?.open, docs.b.title);
  await openDocument(docs.a);
  assert.equal(await page.locator("#preview .tiptap").getAttribute("contenteditable"), "false");
  await page.locator(`#preview a[href="${docs.b.id}.md"]`).click();
  await poll(title => document.querySelector("#title")?.value === title, docs.b.title);
  checks.nodeAndBodyLinkNavigation = true;

  await openDocument(docs.a);
  await page.keyboard.press("e");
  await page.locator("#preview .tiptap").press("Control+End");
  await page.keyboard.insertText("未保存图谱草稿");
  await poll(() => document.querySelector("#state")?.textContent?.includes("未保存"));
  await graphOpen();
  await page.locator(`[data-graph-id="${docs.b.id}"]`).click();
  await page.locator('[data-choice="cancel"]').click();
  assert.equal(await page.locator("#graph-workspace").evaluate(element => element.open), true);
  assert.match(await page.locator("#preview .tiptap").innerText(), /未保存图谱草稿/);
  await page.locator(`[data-graph-id="${docs.b.id}"]`).click();
  await page.locator('[data-choice="discard"]').click();
  await poll(title => document.querySelector("#title")?.value === title && !document.querySelector("#graph-workspace")?.open, docs.b.title);
  checks.unsavedDraftGuard = true;

  await graphOpen();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#graph-workspace").evaluate(element => element.open), false);
  assert.equal(await page.locator("#library-overlay").evaluate(element => element.open), true);
  checks.escapeReturnsToLibrary = true;
  await app.close(); app = undefined;
  await launch();
  await graphOpen();
  assert.equal(await page.locator(`[data-graph-edge="${docs.a.id}:${docs.b.id}"]`).count(), 1);
  checks.restartPersistence = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(join(evidence, "result.json"), JSON.stringify({ checks, errors, requests }, null, 2));
  console.log("Graph UI: document link insertion, rendering, filtering, zoom, navigation, draft guard, Escape and restart passed.");
} catch (error) {
  await page?.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
  await writeFile(join(evidence, "failure.json"), JSON.stringify({ checks, errors, requests, error: String(error), stack: error.stack }, null, 2));
  throw error;
} finally {
  await app?.close();
}
