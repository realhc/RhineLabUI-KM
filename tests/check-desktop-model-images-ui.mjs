import { _electron as electron } from "playwright";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

// Exercise the final portable build with a separate library and Chromium profile.
const out = resolve("verification/model-images");
const run = resolve("release/model-images-test", String(Date.now()));
const portable = join(run, "portable");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: source => !source.split(/[\\/]/).includes("RhineLabData"),
});
let app, p;
const errors = [], requests = [], checks = {};
async function poll(fn, arg, timeout = 90000) {
  const deadline = Date.now() + timeout;
  do {
    if (await p.evaluate(fn, arg)) return;
    await p.waitForTimeout(80);
  } while (Date.now() < deadline);
  throw new Error("Model image UI check timed out: " + fn);
}
async function launch() {
  app = await electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: ["--user-data-dir=" + join(run, "profile")],
    timeout: 60000,
  });
  p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  p.on("pageerror", e => errors.push(e.message));
  p.on("request", r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await poll(() => window.rhineReview?.stats().ready);
  await p.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await p.evaluate(() => window.rhineReview.archive());
  await p.waitForTimeout(2200);
}
async function chooseFile(file = null) {
  await app.evaluate(({ dialog }, file) => {
    globalThis.modelImageDialogCalls ??= 0;
    dialog.showOpenDialog = async () => {
      globalThis.modelImageDialogCalls++;
      return { canceled: !file, filePaths: file ? [file] : [] };
    };
  }, file);
}
const dialogCalls = () => app.evaluate(() => globalThis.modelImageDialogCalls || 0);
const documentById = id => p.evaluate(async id => (await window.rhine.list()).documents.find(d => d.id === id), id);
async function openDocument(id, title, trash = false) {
  if (!(await p.locator("#library-overlay").evaluate(el => el.open).catch(() => false))) {
    await p.locator('[data-action="search"]').click();
    await poll(() => document.querySelector("#library-overlay")?.open);
  }
  await p.locator(`[data-view="${trash ? "trash" : "all"}"]`).click();
  await p.locator("#search").fill(title);
  await p.locator(`#documents .document[data-id="${id}"]`).click();
  await poll(({ title, trash }) => document.querySelector("#title").value === title && document.querySelector("#restore").hidden === !trash, { title, trash });
}
async function closeLibrary() {
  await p.locator("#library-close").click();
  await poll(() => !document.querySelector("#library-overlay").open);
}
async function selectedImage(id, reference) {
  await poll(({ id, reference }) => {
    const s = window.rhineReview.stats();
    return s.selected === id && s.modelImages.selected === `${id}:${reference}` && s.modelImages.selectedReady;
  }, { id, reference });
}
async function showDetail() {
  await p.evaluate(() => window.rhineReview.detail());
  await poll(() => window.rhineReview.stats().mode === "detail");
  await poll(() => {
    const s = window.rhineReview.stats();
    return s.cameraDetail > .995 && s.extraction > 4 && s.decryption.modelClarity > .98;
  });
}
async function capture(name) {
  const png = await p.screenshot({ path: join(out, name + ".png") });
  return app.evaluate(({ nativeImage }, image) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(image, "base64")).toBitmap();
    let red = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const b = pixels[i], g = pixels[i + 1], r = pixels[i + 2];
      if (r > 130 && r > g * 1.8 && r > b * 1.4) red++;
      if (b > 100 && b > r * 1.5 && b > g * 1.15) blue++;
    }
    return { red, blue };
  }, png.toString("base64"));
}

try {
  await launch();
  const fixtures = await p.evaluate(() => {
    const image = (width, height, color) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = color; context.fillRect(0, 0, width, height);
      context.strokeStyle = "white"; context.lineWidth = Math.min(width, height) / 16;
      context.strokeRect(width * .1, height * .1, width * .8, height * .8);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return { red: image(1600, 800, "#e61d37"), blue: image(640, 1280, "#184deb") };
  });
  const red = join(run, "landscape.png"), blue = join(run, "portrait.jpg"), invalid = join(run, "invalid.jpg");
  await writeFile(red, Buffer.from(fixtures.red, "base64"));
  const jpeg = await app.evaluate(({ nativeImage }, source) => nativeImage.createFromBuffer(Buffer.from(source, "base64")).toJPEG(95).toString("base64"), fixtures.blue);
  await writeFile(blue, Buffer.from(jpeg, "base64"));
  await writeFile(invalid, "This is not an image.");
  const body = "# 模型图片验证\n\n正文必须保持不变。\n";
  const { a, b } = await p.evaluate(async body => {
    const c = await window.rhine.createCategory("模型图片验证");
    const a = await window.rhine.create({ title: "图片模型甲", category: c.name, categoryId: c.id, body });
    const b = await window.rhine.create({ title: "图片模型乙", category: c.name, categoryId: c.id, body: "独立文档" });
    return { a, b };
  }, body);
  await openDocument(a.id, a.title);
  assert.equal(await p.locator("#remove-model-image").isVisible(), false);
  await chooseFile(red);
  await p.locator("#model-image").evaluate(button => { button.click(); button.click(); });
  await poll(async id => !!(await window.rhine.list()).documents.find(d => d.id === id)?.modelImage, a.id);
  const first = await documentById(a.id);
  assert.match(first.modelImage, /^[a-f0-9]{64}\.png$/);
  assert.equal(first.body, body);
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal(await p.locator("#model-image").innerText(), "更换模型图片");
  assert.equal(await p.locator("#remove-model-image").isVisible(), true);
  assert.equal(await dialogCalls(), 1, "Repeated clicks must open only one image picker");
  const stored = await readFile(join(portable, "RhineLabData/assets/model-images", first.modelImage));
  assert.equal(stored.readUInt32BE(16), 1024);
  assert.equal(stored.readUInt32BE(20), 512);
  checks.importAndResize = true;

  await chooseFile(null);
  await p.locator("#model-image").click();
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal((await documentById(a.id)).revision, first.revision);
  checks.cancelKeepsImage = true;

  await chooseFile(invalid);
  await p.locator("#model-image").click();
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal((await documentById(a.id)).modelImage, first.modelImage);
  assert.equal(await p.locator("#notice").isVisible(), true);
  assert.match(await p.locator("#notice").innerText(), /图片|文件/);
  checks.invalidKeepsImage = true;

  await p.locator("#save").click();
  await p.locator("#preview .tiptap").press("Control+End");
  await p.keyboard.insertText("未保存的正文");
  const callsBefore = await dialogCalls();
  await p.locator("#model-image").click();
  await p.locator('[data-choice="cancel"]').click();
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal(await dialogCalls(), callsBefore);
  assert.match(await p.locator("#preview .tiptap").innerText(), /未保存的正文/);
  await chooseFile(null);
  await p.locator("#model-image").click();
  await p.locator('[data-choice="discard"]').click();
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal((await documentById(a.id)).body, body);
  assert.doesNotMatch(await p.locator("#preview .tiptap").innerText(), /未保存的正文/);
  checks.unsavedGuard = true;

  await closeLibrary();
  await selectedImage(a.id, first.modelImage);
  await poll(() => {
    const s = window.rhineReview.stats();
    return Math.abs(s.laneFocus - s.selectedCell.lane) < .005 && s.extraction > .399;
  });
  await poll(() => window.rhineReview.stats().modelImages.visible > 1);
  checks.repeatedArrayInstances = await p.evaluate(() => window.rhineReview.stats().modelImages.visible);
  const arrayPixels = await capture("array-landscape");
  assert(arrayPixels.red > 40, "The print must be visible while browsing the model array");
  checks.arrayPixels = arrayPixels;
  await showDetail();
  const redPixels = await capture("detail-landscape");
  assert(redPixels.red > 40, "The decoded red print must also be visible in the actual detail render");
  checks.detailPixels = redPixels;

  await p.locator('[data-action="model-viewer"]').click();
  await poll(() => {
    const viewer = document.querySelector(".model-viewer");
    return viewer && !viewer.hidden && JSON.parse(viewer.dataset.stats || "{}").ready;
  });
  await p.waitForTimeout(500);
  const viewerPixels = await capture("viewer-landscape");
  assert(viewerPixels.red > 40, "The separate 360° model must contain the print");
  await p.locator('[data-viewer="explode"]').click();
  await p.waitForTimeout(900);
  await capture("viewer-exploded");
  await p.locator('[data-viewer="assemble"]').click();
  await p.locator('[data-viewer="close"]').click();
  await poll(() => document.querySelector(".model-viewer").hidden);
  checks.viewer = viewerPixels;

  await openDocument(b.id, b.title);
  await closeLibrary();
  await poll(id => window.rhineReview.stats().selected === id && !window.rhineReview.stats().modelImages.selected, b.id);
  await openDocument(a.id, a.title);
  await chooseFile(blue);
  await p.locator("#model-image").click();
  await poll(async ({ id, previous }) => {
    const doc = (await window.rhine.list()).documents.find(d => d.id === id);
    return !!doc?.modelImage && doc.modelImage !== previous;
  }, { id: a.id, previous: first.modelImage });
  const second = await documentById(a.id);
  assert.equal(second.body, body);
  await closeLibrary();
  await selectedImage(a.id, second.modelImage);
  await showDetail();
  const bluePixels = await capture("detail-portrait");
  assert(bluePixels.blue > 40, "Replacement portrait must be visible without stretching");
  checks.replaceAndSwitch = bluePixels;

  await app.close(); app = undefined;
  await launch();
  assert.equal((await documentById(a.id)).modelImage, second.modelImage);
  await openDocument(a.id, a.title);
  await closeLibrary();
  await selectedImage(a.id, second.modelImage);
  checks.restartPersistence = true;

  await openDocument(a.id, a.title);
  await p.locator("#remove").click();
  await p.locator('[data-choice="delete"]').click();
  await poll(async id => (await window.rhine.list()).trash.some(d => d.id === id), a.id);
  await openDocument(a.id, a.title, true);
  assert.equal(await p.locator("#model-image").isVisible(), false);
  assert.equal(await p.locator("#remove-model-image").isVisible(), false);
  await p.locator("#restore").click();
  await poll(async id => (await window.rhine.list()).documents.some(d => d.id === id), a.id);
  assert.equal((await documentById(a.id)).modelImage, second.modelImage);
  await p.locator("#remove-model-image").click();
  await poll(async id => !(await window.rhine.list()).documents.find(d => d.id === id).modelImage, a.id);
  await poll(() => !document.querySelector("#model-image").disabled);
  assert.equal((await documentById(a.id)).body, body);
  assert.equal(await p.locator("#remove-model-image").isVisible(), false);
  await closeLibrary();
  await poll(() => !window.rhineReview.stats().modelImages.selected && window.rhineReview.stats().modelImages.visible === 0);
  checks.trashRestoreAndRemove = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(join(out, "result.json"), JSON.stringify({ checks, errors, requests, portable }, null, 2));
  console.log("Model images: import, resize, cancel, invalid, drafts, array/detail/viewer, replacement, restart, trash and removal passed.");
} catch (error) {
  await p?.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  await writeFile(join(out, "failure.json"), JSON.stringify({ checks, errors, requests, error: String(error) }, null, 2));
  throw error;
} finally {
  await app?.close();
}
