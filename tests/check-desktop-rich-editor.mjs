import { _electron as electron } from "playwright";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const out = resolve("verification/rich-editor"),
  run = resolve("release/rich-test", Date.now().toString()),
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
let app = await launch(),
  p = await app.firstWindow();
p.setDefaultTimeout(15000);
const errors = [],
  requests = [],
  failed = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("request", (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url());
});
p.on("response", (r) => {
  if (r.status() >= 400) failed.push(r.url());
});
const poll = async (fn, arg) => {
  const end = Date.now() + 60000;
  do {
    if (await p.evaluate(fn, arg)) return;
    await p.waitForTimeout(80);
  } while (Date.now() < end);
  throw Error("Timeout waiting for editor state");
};
const content = () => p.locator("#preview .tiptap");
async function selectText(text) {
  await content().evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const start = n.textContent.indexOf(text);
      if (start >= 0) {
        el.focus();
        const range = document.createRange();
        range.setStart(n, start);
        range.setEnd(n, start + text.length);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return;
      }
    }
    throw Error("No text " + text);
  }, text);
  await p.waitForTimeout(100);
}
async function atEnd() {
  await content().focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(120);
}
let id, secondId, groupId, original;
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await poll(() => window.rhineReview?.stats().ready);
  original =
    "# 原始标题\n\n样式测试段落\n\n链接文字\n\n代码内容\n\n末尾\n\n$E=mc^2$\n\n$$\n\\sum_{i=1}^{n}i\n$$\n\n![附件](https://example.com/never-fetch.png)\n\n<script>window.unsafe=true</script>";
  const seed = await p.evaluate(async (body) => {
    const c = await window.rhine.createCategory("编辑测试");
    const a = await window.rhine.create({
      title: "富文本测试",
      category: "编辑测试",
      categoryId: c.id,
      body,
    });
    const b = await window.rhine.create({
      title: "另一份文档",
      category: "编辑测试",
      categoryId: c.id,
      body: "独立内容",
    });
    return { id: a.id, secondId: b.id, groupId: c.id };
  }, original);
  ({ id, secondId, groupId } = seed);
  await p.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await p.evaluate(() => window.rhineReview.archive());
  await p.waitForTimeout(2400);
  await p.locator('[data-action="search"]').click();
  await poll(() => document.querySelector("#library-overlay")?.open);
  await p.locator("#search").fill("富文本测试");
  await p.locator("#documents .document").click();
  await poll(() => document.querySelector("#title").value === "富文本测试" && document.querySelector("#preview .tiptap").contentEditable === "false");
  assert.equal(
    await p
      .locator("#library-overlay")
      .locator("#category,[data-mode],#body")
      .count(),
    0,
  );
  assert.equal(await content().getAttribute("contenteditable"), "false");
  assert.equal(await p.locator("#save").innerText(), "编辑");
  assert.equal(await p.locator("#preview .katex").count(), 2);
  assert.equal(await p.locator("#preview img[src]").count(), 0);
  assert.equal(await p.evaluate(() => window.unsafe), undefined);
  const panel = await p.locator(".library-controls").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      shadow: s.boxShadow,
      border: s.borderTopWidth,
    };
  });
  assert.deepEqual(panel, {
    bg: "rgba(0, 0, 0, 0)",
    shadow: "none",
    border: "0px",
  });
  await p.keyboard.press("e");
  assert.equal(await content().getAttribute("contenteditable"), "true");
  assert.equal(await p.locator("#save").innerText(), "保存");
  // Entering and saving without edits must keep original Markdown bytes.
  await p.keyboard.press("Control+s");
  assert.equal(
    (await p.evaluate((id) => window.rhine.read(id), id)).body,
    original,
  );
  for (const level of [1, 2, 3, 4, 0]) {
    await selectText("样式测试段落");
    await p.locator("#text-style").selectOption(String(level));
    assert.match(
      await p
        .locator("#preview " + (level ? "h" + level : "p"))
        .allTextContents()
        .then((x) => x.join("\n")),
      /样式测试段落/,
    );
  }
  for (const [command, tag] of [
    ["bold", "strong"],
    ["italic", "em"],
    ["underline", "u"],
  ]) {
    await selectText("样式测试段落");
    await p.locator("[data-command=" + command + "]").click();
    assert.match(
      await p.locator("#preview " + tag).innerText(),
      /样式测试段落/,
    );
  }
  await selectText("链接文字");
  await p.locator("[data-command=link]").click();
  await p.locator("#editor-value").fill("https://example.com/archive");
  await p.locator("[data-choice=confirm]").click();
  assert.equal(
    await p.locator("#preview a").getAttribute("href"),
    "https://example.com/archive",
  );
  await selectText("代码内容");
  await p.locator("[data-command=codeBlock]").click();
  assert.match(await p.locator("#preview pre").innerText(), /代码内容/);
  await p.locator("#code-language").selectOption("typescript");
  await atEnd();
  await p.keyboard.press("Enter");
  await p.locator("[data-command=table]").click();
  await p.locator("#editor-rows").fill("3");
  await p.locator("#editor-cols").fill("2");
  await p.locator("[data-choice=confirm]").click();
  assert.equal(await p.locator("#preview table tr").count(), 3);
  await p.locator("#preview table td").first().click();
  await p.keyboard.type("单元格");
  await p.locator("[data-command=addRowAfter]").click();
  assert.equal(await p.locator("#preview table tr").count(), 4);
  await p.locator("[data-command=addColumnAfter]").click();
  assert.equal(
    await p.locator("#preview table tr").first().locator("th,td").count(),
    3,
  );
  await atEnd();
  await p.keyboard.press("ArrowDown");
  await p.locator("[data-command=math]").click();
  await p.locator("#editor-value").fill("\\frac{a}{b}");
  await p.locator("[data-choice=confirm]").click();
  assert.equal(await p.locator("#preview .katex").count(), 3);
  await p
    .locator("#preview [data-type=inline-math]")
    .filter({ has: p.locator(".katex") })
    .first()
    .click();
  await p.locator("#editor-value").fill("\\frac{x}{y}");
  await p.locator("[data-choice=confirm]").click();
  await p.keyboard.press("Control+s");
  await poll(
    async (id) => (await window.rhine.read(id)).body.includes("++"),
    id,
  );
  assert.equal(await content().getAttribute("contenteditable"), "true");
  await poll(() => !document.querySelector("#save").disabled && document.querySelector("#state").textContent.includes("已保存"));
  const stored = await p.evaluate((id) => window.rhine.read(id), id);
  assert.match(stored.body, /\+\+/);
  assert.match(stored.body, /typescript/);
  assert.match(stored.body, /代码内容/);
  assert.match(stored.body, /window.unsafe=true/);
  assert.match(stored.body, /example.com\/archive/);
  assert.match(stored.body, /frac\{x\}\{y\}/);
  assert.match(stored.body, /单元格/);
  assert.match(stored.body, /never-fetch.png/);
  await p.screenshot({ path: join(out, "editing-light.png") });
  await p.locator("#search").fill("另一份文档");
  await p.locator("#documents .document").click();
  await poll(() => document.querySelector("#title").value === "另一份文档" && document.querySelector("#preview .tiptap").contentEditable === "false");
  assert.equal(await content().getAttribute("contenteditable"), "false");
  await p.keyboard.press("e");
  assert.equal(
    await p.locator("[data-command=undo]").isEnabled(),
    false,
    "undo must not expose prior document",
  );
  await p.locator("#search").fill("富文本测试");
  await p.locator("#documents .document").click();
  await poll(() => document.querySelector("#title").value === "富文本测试" && document.querySelector("#preview .tiptap").contentEditable === "false");
  assert.equal(await content().getAttribute("contenteditable"), "false");
  assert.equal(await p.locator("#preview u").count(), 1);
  assert.equal(await p.locator("#preview table").count(), 1);
  assert.equal(await p.locator("#preview .katex").count(), 3);
  await p.keyboard.press("e");
  // Add a real draft after the multi-node document. Table selection is a separate
  // interaction and must not decide whether the unsaved-document guard is tested.
  await content().press("Control+End");
  await p.keyboard.insertText("未保存内容");
  const unsavedText = (await content().innerText()).trim();
  assert(unsavedText.includes("未保存内容"));
  await p.locator("#search").fill("另一份文档");
  await p.locator("#documents .document").click();
  await p.locator("[data-choice=cancel]").click();
  assert.equal((await content().innerText()).trim(), unsavedText);
  await p.locator("#documents .document").click();
  await p.locator("[data-choice=discard]").click();
  await poll(() => document.querySelector("#title").value === "另一份文档");
  assert.equal((await content().innerText()).trim(), "独立内容");
  // Drag from the title at the centre of the whole row, not the tick handle.
  const dest = await p.evaluate(() => window.rhine.createCategory("拖放目标"));
  await p.locator("#search").fill("");
  await poll(
    (id) => !!document.querySelector('[data-category-id="' + id + '"]'),
    dest.id,
  );
  await p
    .locator('[data-id="' + secondId + '"] .directory-label')
    .dragTo(p.locator('[data-category-id="' + dest.id + '"]'));
  await poll(
    async ([id, c]) => (await window.rhine.read(id)).categoryId === c,
    [secondId, dest.id],
  );
  await p.locator("#search").fill("富文本测试");
  await p.locator("#documents .document").click();
  await p.locator("#library-close").click();
  await p.locator("[data-action=settings]").click();
  await p.locator("[data-color-theme=dark]").click();
  await p.waitForTimeout(700);
  await p.locator("[data-action=close-modal]").click();
  await p.waitForTimeout(300);
  await p.locator("[data-action=search]").click();
  await p.locator("#search").fill("富文本测试");
  await p.locator("#documents .document").click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1000, 680),
  );
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(out, "reading-dark-small.png") });
  await p.locator("#remove").click();
  await p.locator("[data-choice=delete]").click();
  await poll(() => document.querySelector("#editor").hidden);
  await p.locator("[data-view=trash]").click();
  await p.locator("#documents .document").click();
  assert.equal(await content().getAttribute("contenteditable"), "false");
  assert.equal(await p.locator("#save").isVisible(), false);
  await p.locator("#restore").click();
  await poll(
    async (id) =>
      (await window.rhine.list()).documents.some((d) => d.id === id),
    id,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert.deepEqual(failed, []);
  await app.close();
  app = await launch();
  p = await app.firstWindow();
  await poll(() => window.rhineReview?.stats().ready);
  const restored = await p.evaluate((id) => window.rhine.read(id), id);
  assert.equal(restored.body, stored.body);
  await writeFile(
    join(out, "result.json"),
    JSON.stringify(
      {
        renderedOnly: true,
        transparentControls: true,
        editShortcut: true,
        saveKeepsEditing: true,
        originalBytesPreserved: true,
        headingLevels: true,
        selectedMarks: true,
        link: true,
        codeBlock: true,
        tableEditing: true,
        latexRoundtrip: true,
        attachmentPreserved: true,
        undoIsolation: true,
        unsavedGuard: true,
        wholeRowDrag: true,
        trashRestore: true,
        restart: true,
        offline: true,
        errors,
        failed,
      },
      null,
      2,
    ),
  );
  console.log("Rich document editor interaction and persistence passed");
} catch (err) {
  await p.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  console.error("ERRORS", errors, "FAILED", failed, err);
  throw err;
} finally {
  await app.close();
}
