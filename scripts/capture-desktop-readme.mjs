// Capture the packaged desktop client in a disposable, isolated portable copy.
// Never reads, changes, or copies the user's RhineLabData folder.
import { _electron as electron } from "playwright";
import { extractFile } from "@electron/asar";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const argument = (name, fallback) =>
  process.argv.find((value) => value.startsWith(name + "="))?.slice(name.length + 1) ?? fallback;
const source = resolve(argument("--package", "release/packages/RhineLab-win32-x64"));
const output = resolve(argument("--out", "docs/media"));
const expectedVersion = argument("--expected-version", JSON.parse(await readFile("package.json", "utf8")).version);
const [width, height] = argument("--size", "1920x1080").split("x").map(Number);
assert.ok(Number.isInteger(width) && Number.isInteger(height) && width >= 1000 && height >= 680, "Invalid capture size");
const packagedMetadata = JSON.parse(extractFile(join(source, "resources/app.asar"), "package.json").toString("utf8"));
assert.equal(packagedMetadata.version, expectedVersion, "Build the requested client version before capturing");
const run = resolve("release/readme-capture", String(Date.now()));
const portable = join(run, "portable");
await mkdir(output, { recursive: true });
await cp(source, portable, {
  recursive: true,
  filter: (file) => !file.split(/[\\/]/).some((part) => part.toLowerCase() === "rhinelabdata"),
});

const fixtureBody = [
  "# 研究手记",
  "把想法写下来，让每一条记录都有自己的位置。",
  "",
  "## 记录与整理",
  "左侧的大刻度是分类，小刻度是文档。拖动整条文档就能归类；记录始终保存在本地 **Markdown 文件** 中。",
  "",
  "> 先记录，再整理。关闭窗口时，未保存的内容会提醒你处理。",
  "",
  "## 轻松表达",
  "选中文字后，可以设置标题、**粗体**、*斜体*、下划线与链接，也可以插入表格和公式。",
  "",
  "| 记录类型 | 用途 | 状态 |",
  "| --- | --- | --- |",
  "| 研究笔记 | 整理想法与问题 | 持续更新 |",
  "| 阅读摘录 | 留下重要观点 | 已归档 |",
  "",
  "行内公式：$E = mc^2$。",
  "",
  "```typescript",
  "const note = { title: '研究手记', saved: true };",
  "```",
].join("\n");
const captures = [], errors = [], network = [];
let app, page, fixture;
async function poll(check, arg, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(check, arg)) return;
    await page.waitForTimeout(80);
  }
  throw new Error("Capture timed out: " + check);
}
async function capture(name, description) {
  await page.mouse.move(18, 18);
  await page.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap = await BrowserWindow.getAllWindows()[0].capturePage();
    return { size: bitmap.getSize(), bytes: bitmap.toJPEG(92).toString("base64") };
  });
  assert.equal(shot.size.width, width, "Screenshot width differs from requested viewport");
  assert.equal(shot.size.height, height, "Screenshot height differs from requested viewport");
  const bytes = Buffer.from(shot.bytes, "base64");
  assert.ok(bytes.length > 25000, "Capture appears empty");
  await writeFile(join(output, name + ".jpg"), bytes);
  captures.push({ file: name + ".jpg", description, size: shot.size, bytes: bytes.length });
}
async function openLibrary() {
  await page.locator("[data-action=search]").click();
  await poll(() => document.querySelector("#library-overlay")?.dataset.motionState === "open");
  await page.locator("#search").fill(fixture.title);
  await page.locator('[data-id="' + fixture.id + '"]').click();
  await poll((title) => document.querySelector("#title").value === title, fixture.title);
  await page.locator("#search").fill("");
  await page.locator('[data-id="' + fixture.id + '"]').evaluate((row) => row.scrollIntoView({ block: "center" }));
  await page.locator("#save").click();
  await page.waitForTimeout(800);
}
async function closeLibrary() {
  await page.locator("#library-close").click();
  await poll(() => document.querySelector("#library-overlay").dataset.motionState === "closed");
}

try {
  app = await electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: [
      "--user-data-dir=" + join(run, "profile"),
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-gpu-shader-disk-cache",
      "--use-angle=d3d11",
      "--force-device-scale-factor=1",
    ],
    timeout: 60000,
  });
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion);
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(...size);
    window.webContents.setBackgroundThrottling(false);
    window.focus();
  }, [width, height]);
  // firstWindow is available before the initial loadURL has necessarily finished.
  // Wait for the live application before replacing its isolated preferences.
  await poll(() => window.rhineReview?.stats().ready);
  await page.addInitScript(() => localStorage.setItem("rhine-settings", JSON.stringify({ colorTheme: "light", sound: false, music: false })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await poll(() => window.rhineReview?.stats().ready);
  if (await page.locator(".entry-start").count()) await page.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await page.locator("#skip").click();
  await poll(() => window.rhineReview.stats().mode === "archive");
  await page.waitForTimeout(3500);
  const arrayStats = await page.evaluate(() => window.rhineReview.stats());
  assert.ok(arrayStats.archiveCount > 100 && arrayStats.drawCalls > 40, "Array must be fully rendered");
  assert.equal(arrayStats.renderHealth.graphicsLost, false);
  await capture("array", "完整浅色三维档案阵列，默认画质与完整动效");

  fixture = await page.evaluate(async (body) => {
    const data = await window.rhine.list();
    const category = data.categories[0];
    return window.rhine.create({ title: "研究手记 · 从一条记录开始", category: category.name, categoryId: category.id, body });
  }, fixtureBody);
  await page.waitForTimeout(500);
  await openLibrary();
  assert.equal(await page.locator("#preview .tiptap table").count(), 1, "Fixture table must render");
  assert.ok(await page.locator("#preview .katex").count(), "Fixture LaTeX must render");
  await capture("library", "浅色知识库：贯穿刻度目录、透明工具区与可视化编辑正文");
  await closeLibrary();

  await page.locator("[data-action=settings]").click();
  await page.locator("[data-color-theme=dark]").click();
  await page.waitForTimeout(1800);
  await page.locator("[data-action=close-modal]").click();
  await page.waitForTimeout(600);
  await openLibrary();
  await capture("library-dark", "暗色知识库，同一文档与工具区");
  await closeLibrary();

  await page.locator("[data-action=settings]").click();
  await page.locator("[data-color-theme=light]").click();
  await page.waitForTimeout(1800);
  await capture("settings", "终端偏好：配色、声音、动态效果与画质设置");
  await page.locator("[data-action=close-modal]").click();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.rhineReview.detail());
  await page.waitForTimeout(2000);
  await page.locator("[data-action=model-viewer]").click();
  await poll(() => JSON.parse(document.querySelector(".model-viewer")?.dataset.stats || "{}").ready);
  await page.locator("[data-viewer=clear]").click();
  await page.locator("[data-viewer=explode]").click();
  await poll(() => JSON.parse(document.querySelector(".model-viewer").dataset.stats).spread > 0.999);
  await page.waitForTimeout(500);
  await capture("viewer", "360° 模型查看器：清晰表面与完整拆解结构");

  assert.deepEqual(errors, [], "Runtime errors during capture");
  assert.deepEqual(network, [], "Captures must not depend on remote pages or assets");
  await writeFile(join(output, "capture-notes.json"), JSON.stringify({
    capturedAt: new Date().toISOString(),
    version: expectedVersion,
    viewport: { width, height, deviceScaleFactor: 1 },
    source: "packaged Electron desktop client",
    method: "BrowserWindow.capturePage / NativeImage.toJPEG(92)",
    fixtures: [{ title: fixture.title, category: fixture.category, body: fixtureBody, scope: "disposable portable copy only" }],
    captures,
    errors,
    remoteRequests: network,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ version: expectedVersion, captures, errors, remoteRequests: network }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: join(run, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {});
  await app?.close().catch(() => {});
}
