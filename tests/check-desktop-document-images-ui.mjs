import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

// A single reusable isolated client and profile. Never use a real personal library.
// Cleanup is intentionally left to the final, explicitly approved cleanup step.
const out = resolve("verification/document-images");
const run = resolve("release/document-images-test");
const portable = join(run, "portable");
const source = resolve(process.env.RHINE_TEST_PORTABLE || "release/packages/RhineLab-win32-x64");
const within = relative(resolve("release"), run);
assert(!within.startsWith("..") && !isAbsolute(within), "The test run must stay inside release/");
assert.notEqual(source, portable);
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(source, portable, {
  recursive: true,
  filter: path => !path.split(/[\\/]/).some(part => part.toLowerCase() === "rhinelabdata"),
});

let app, page;
const errors = [], requests = [], checks = {};
const titleSuffix = String(Date.now());
const refPattern = /\.\.\/assets\/document-images\/[a-f0-9]{64}\.(?:png|jpg)/g;
const body = "DropLeftDropRight\n\nPasteLeftPasteRight\n\nMapLeftMapRight\n\nTailLeftTailRight\n";
const editor = () => page.locator("#preview .tiptap");
const images = () => page.locator("#preview .document-image img");
const readDocument = id => page.evaluate(id => window.rhine.read(id), id);

async function poll(test, arg, timeout = 90000) {
  const end = Date.now() + timeout;
  do {
    if (await page.evaluate(test, arg)) return;
    await page.waitForTimeout(80);
  } while (Date.now() < end);
  throw new Error("Document image UI check timed out: " + test);
}
async function launch() {
  app = await electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: ["--user-data-dir=" + join(run, "profile")],
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^(?:https?|file):/i.test(request.url())) requests.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await poll(() => window.rhineReview?.stats().ready);
  if ((await page.evaluate(() => window.rhineReview.stats().startup)) !== "started") await page.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await page.evaluate(() => window.rhineReview.archive());
}
async function openDocument(doc, trash = false) {
  if (!(await page.locator("#library-overlay").evaluate(element => element.open).catch(() => false))) {
    await page.locator('[data-action="search"]').click();
  }
  await poll(() => document.querySelector("#library-overlay")?.open && document.querySelector("#library-overlay").dataset.motionState === "open");
  await page.locator(`[data-view="${trash ? "trash" : "all"}"]`).click();
  await page.locator("#search").fill(doc.title);
  await page.locator(`#documents .document[data-id="${doc.id}"]`).click();
  await poll(({ title, trash }) => document.querySelector("#title").value === title && document.querySelector("#restore").hidden === !trash && !document.querySelector("#editor").hidden, { title: doc.title, trash });
}
async function loaded(count) {
  await poll(count => {
    const images = [...document.querySelectorAll("#preview .document-image img")];
    return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
  }, count);
}
async function caret(text, offset = text.length) {
  await editor().evaluate((root, { text, offset }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      node.parentElement.scrollIntoView({ block: "center" });
      root.focus();
      const range = document.createRange();
      range.setStart(node, start + offset); range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw Error("Missing caret marker: " + text);
  }, { text, offset });
  await page.waitForTimeout(80);
}
async function drop(text, offset, files, { prefix = "", saveImmediately = false } = {}) {
  return editor().evaluate((root, { text, offset, files, prefix, saveImmediately }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(text);
      if (start < 0) continue;
      node.parentElement.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(node, start + offset); range.collapse(true);
      const rect = range.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), value => value.charCodeAt(0));
        dataTransfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const coordinates = { clientX: rect.left + .1, clientY: rect.top + Math.max(1, rect.height / 2) };
      root.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...coordinates }));
      const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...coordinates });
      root.dispatchEvent(event);
      const pendingAtDrop = !!root.querySelector("[data-image-import]");
      if (prefix) {
        // File.arrayBuffer is still pending. A real native input transaction
        // before the anchor must map the eventual import to its new position.
        const prefixWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const marker = text.slice(0, offset);
        let prefixNode;
        while ((prefixNode = prefixWalker.nextNode())) if (prefixNode.data.includes(marker)) break;
        if (!prefixNode) throw Error("The import anchor lost its left text marker");
        const selection = getSelection(), editRange = document.createRange();
        editRange.setStart(prefixNode, prefixNode.data.indexOf(marker)); editRange.collapse(true);
        root.focus(); selection.removeAllRanges(); selection.addRange(editRange);
        document.dispatchEvent(new Event("selectionchange"));
        if (!document.execCommand("insertText", false, prefix)) throw Error("Could not type during the asynchronous import");
      }
      if (saveImmediately) root.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
      return { defaultPrevented: event.defaultPrevented, pendingAtDrop, coordinates };
    }
    throw Error("Missing drop marker: " + text);
  }, { text, offset, files, prefix, saveImmediately });
}
async function paste(file) {
  await editor().evaluate((root, file) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(file.base64), value => value.charCodeAt(0))], file.name, { type: file.type }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    root.dispatchEvent(event);
    if (!event.defaultPrevented) throw Error("Image paste did not prevent the browser default");
  }, file);
}
async function save(id, expectedCount) {
  await page.keyboard.press("Control+s");
  await poll(async ({ id, expectedCount }) => {
    const doc = await window.rhine.read(id);
    return (doc.body.match(/\.\.\/assets\/document-images\/[a-f0-9]{64}\.(?:png|jpg)/g) || []).length === expectedCount && !document.querySelector("#save").disabled && document.querySelector("#state").textContent.includes("已保存");
  }, { id, expectedCount });
  return readDocument(id);
}
async function picker(paths = []) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: !paths.length, filePaths: paths });
  }, paths);
}
async function imagePixels(index, filename) {
  const image = images().nth(index);
  await image.scrollIntoViewIfNeeded();
  const png = await image.screenshot({ path: join(out, filename) });
  return app.evaluate(({ nativeImage }, base64) => {
    const bitmap = nativeImage.createFromBuffer(Buffer.from(base64, "base64")).toBitmap();
    let red = 0, blue = 0, green = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
      if (r > 130 && r > g * 1.8 && r > b * 1.4) red++;
      if (b > 100 && b > r * 1.5 && b > g * 1.15) blue++;
      if (g > 100 && g > r * 1.4 && g > b * 1.2) green++;
    }
    return { red, blue, green };
  }, png.toString("base64"));
}

try {
  await launch();
  const fixtures = await page.evaluate(() => {
    function fixture(name, color) {
      const canvas = document.createElement("canvas"); canvas.width = 420; canvas.height = 180;
      const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 420, 180);
      context.fillStyle = "white"; context.font = "24px sans-serif"; context.fillText(name, 18, 42);
      return { name: name + ".png", type: "image/png", base64: canvas.toDataURL("image/png").split(",")[1] };
    }
    return { red: fixture("drop-red", "#e61d37"), blue: fixture("picker-blue", "#184deb"), green: fixture("picker-green", "#168a40"), purple: fixture("mapped-purple", "#8c32b5") };
  });
  const blueJpeg = await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, "base64")).toJPEG(95).toString("base64"), fixtures.blue.base64);
  fixtures.blue = { name: "picker-blue.jpg", type: "image/jpeg", base64: blueJpeg };
  const blueFile = join(run, "picker-blue.jpg"), greenFile = join(run, "picker-green.png");
  await writeFile(blueFile, Buffer.from(blueJpeg, "base64"));
  await writeFile(greenFile, Buffer.from(fixtures.green.base64, "base64"));
  const docs = await page.evaluate(async ({ body, suffix }) => {
    const category = await window.rhine.createCategory("正文图片验证 " + suffix);
    const create = (name, body) => window.rhine.create({ title: name + " " + suffix, category: category.name, categoryId: category.id, body });
    return {
      a: await create("正文图片甲", body),
      b: await create("正文图片乙", "独立文档，没有图片。"),
      unsafe: await create("图片引用边界", "![远程](https://example.com/never-fetch-document-image.png)\n\n![本机](file:///C:/Windows/win.ini)\n\n![越界](../assets/document-images/../../outside.png)\n\n<img src=\"https://example.com/never-fetch-html.png\" onerror=\"window.unsafeImage=true\">"),
    };
  }, { body, suffix: titleSuffix });

  await openDocument(docs.a);
  assert.equal(await editor().getAttribute("contenteditable"), "false");
  await caret("TailRight");
  const dropped = await drop("DropLeftDropRight", "DropLeft".length, [fixtures.red]);
  assert(dropped.defaultPrevented, "Dropping a file must not navigate the window");
  await loaded(1);
  assert.equal(await editor().getAttribute("contenteditable"), "true", "A normal read-only preview should enter editing at the drop location");
  assert.equal((await readDocument(docs.a.id)).body, body, "Importing a file alone must not save or rewrite the Markdown");
  await page.locator('[data-command="undo"]').click(); await loaded(0);
  await page.locator('[data-command="redo"]').click(); await loaded(1);
  let saved = await save(docs.a.id, 1);
  assert.match(saved.body, /DropLeft!\[[^\]]*\]\(<?\.\.\/assets\/document-images\/[a-f0-9]{64}\.png>?(?:\s+"[^"]*")?\)DropRight/);
  assert.doesNotMatch(saved.body, /data:image|blob:|[A-Z]:\\/i);
  const firstReference = saved.body.match(refPattern)[0];
  const asset = await readFile(resolve(portable, "RhineLabData/documents", firstReference));
  assert.equal(basename(firstReference).split(".")[0], createHash("sha256").update(asset).digest("hex"));
  checks.dropCoordinatesAndAutoEdit = dropped;
  checks.undoRedoAndRelativeMarkdown = true;
  const redPixels = await imagePixels(0, "inline-drop.png");
  assert(redPixels.red > 500, "The inserted red image must be painted in the actual editor");
  checks.inlinePixels = redPixels;

  await caret("PasteLeftPasteRight", "PasteLeft".length);
  await paste({ ...fixtures.green, name: "pasted-green.png" }); await loaded(2);
  saved = await save(docs.a.id, 2);
  assert.match(saved.body, /PasteLeft!\[[^\]]*\]\([^\n]+\)PasteRight/);
  checks.clipboardAtCaret = true;

  await caret("TailLeftTailRight", "TailLeft".length);
  await picker([blueFile, greenFile]);
  await page.locator('[data-command="image"]').click(); await loaded(4);
  saved = await save(docs.a.id, 4);
  const pickerImages = await images().evaluateAll(elements => elements.map(image => ({ alt: image.alt, width: image.naturalWidth, height: image.naturalHeight })));
  assert(pickerImages.some(image => /blue/.test(image.alt)), "The JPEG should be imported");
  assert.match(saved.body, /TailLeft!\[[^\]]*\]\([^\n]+\)!\[[^\]]*\]\([^\n]+\)TailRight/);
  const beforeCancel = saved;
  await picker(); await page.locator('[data-command="image"]').click();
  await poll(() => !document.querySelector("#preview [data-image-import]"));
  assert.equal((await readDocument(docs.a.id)).revision, beforeCancel.revision);
  checks.pickerJpegMultiImageAndCancel = true;

  const mapping = await drop("MapLeftMapRight", "MapLeft".length, [fixtures.purple], { prefix: "MappedPrefix", saveImmediately: true });
  assert(mapping.pendingAtDrop, "The mapping test must edit while an import anchor is pending");
  await loaded(5);
  await poll(async id => (await window.rhine.read(id)).body.includes("mapped-purple"), docs.a.id);
  saved = await readDocument(docs.a.id);
  assert.match(saved.body, /MappedPrefixMapLeft!\[[^\]]*\]\([^\n]+\)MapRight/);
  checks.mappingDuringInputAndSaveWait = true;

  const beforeInvalid = saved;
  await drop("DropLeft", 0, [{ name: "invalid.png", type: "image/png", base64: Buffer.from("not an image").toString("base64") }]);
  await poll(() => !document.querySelector("#preview [data-image-import]") && /图片|文件|格式/.test(document.querySelector("#notice").textContent));
  await loaded(5);
  assert.equal((await readDocument(docs.a.id)).revision, beforeInvalid.revision);
  checks.invalidDoesNotPollute = true;

  await openDocument(docs.b);
  assert.equal(await images().count(), 0);
  await page.locator("#save").click();
  assert.equal(await page.locator('[data-command="undo"]').isEnabled(), false, "An independent document must not inherit image undo history");
  await openDocument(docs.a); await loaded(5);
  assert.equal(await editor().getAttribute("contenteditable"), "false");
  checks.documentIsolationAndReload = true;

  await openDocument(docs.unsafe);
  assert.equal(await page.locator("#preview img[src]").count(), 0);
  assert.equal(await page.evaluate(() => window.unsafeImage), undefined);
  const denied = await page.evaluate(async ({ id, other, source }) => {
    const attempt = async (id, src) => { try { await window.rhine.readDocumentImage(id, src); return false; } catch { return true; } };
    return [await attempt(id, "../assets/document-images/../../outside.png"), await attempt(id, "file:///C:/Windows/win.ini"), await attempt(other, source)];
  }, { id: docs.a.id, other: docs.b.id, source: firstReference });
  assert.deepEqual(denied, [true, true, true]);
  checks.unsafeReferencesDoNotFetch = true;

  await openDocument(docs.a);
  await page.locator("#remove").click(); await page.locator('[data-choice="delete"]').click();
  await poll(async id => (await window.rhine.list()).trash.some(doc => doc.id === id), docs.a.id);
  await openDocument(docs.a, true); await loaded(5);
  assert.equal(await editor().getAttribute("contenteditable"), "false");
  const trashDrop = await drop("DropLeft", 0, [fixtures.red]);
  assert(trashDrop.defaultPrevented);
  await loaded(5);
  assert.equal(await editor().getAttribute("contenteditable"), "false");
  assert.equal((await page.evaluate(id => window.rhine.read(id, true), docs.a.id)).body, saved.body);
  await page.locator("#restore").click();
  await poll(async id => (await window.rhine.list()).documents.some(doc => doc.id === id), docs.a.id);
  await loaded(5);
  await page.screenshot({ path: join(out, "reading-images.png") });
  checks.recycleAndRestore = true;

  await app.close(); app = undefined;
  await launch();
  assert.equal((await readDocument(docs.a.id)).body, saved.body);
  await openDocument(docs.a); await loaded(5);
  const dimensions = await images().evaluateAll(elements => elements.map(image => [image.naturalWidth, image.naturalHeight]));
  assert(dimensions.every(([width, height]) => width === 420 && height === 180));
  checks.restartPersistence = true;
  await page.locator("#library-close").click();
  await poll(() => !document.querySelector("#library-overlay").open);
  await page.evaluate(() => window.rhineReview.detail());
  await poll(() => [...document.querySelectorAll("#detail-content .local-markdown img")].length === 5 && [...document.querySelectorAll("#detail-content .local-markdown img")].every(image => image.complete && image.naturalWidth > 0));
  checks.detailReaderImages = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(join(out, "result.json"), JSON.stringify({ checks, errors, requests, portable, retainedRun: run }, null, 2));
  console.log("Document images: drop coordinates, paste, mapped asynchronous input/save, picker, undo, relative Markdown, unsafe references, recycle, restart and detail reader passed.");
} catch (error) {
  await page?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  await writeFile(join(out, "failure.json"), JSON.stringify({ checks, errors, requests, error: String(error), stack: error.stack, portable }, null, 2));
  throw error;
} finally {
  await app?.close();
}
