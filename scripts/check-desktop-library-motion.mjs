import { _electron as electron } from "playwright";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = resolve("verification/client-repair");
const run = resolve("release/library-motion-test", Date.now().toString());
const portable = join(run, "portable");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes("RhineLabData"),
});
let app, p;
const errors = [],
  checks = {},
  samples = {};
const motionKeys = [
  "boot",
  "selectionWave",
  "idleWave",
  "pointerParallax",
  "dragMomentum",
  "selectionTransition",
  "detailTransition",
  "modelDecryption",
  "documentReveal",
  "rollingText",
  "rollingNumbers",
  "surfaceTransitions",
  "viewerNavigation",
  "viewerModelTransition",
];

async function poll(fn, arg, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    if (await p.evaluate(fn, arg)) return;
    await p.waitForTimeout(20);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for library motion: " + fn);
}
const state = () =>
  p.evaluate(() => {
    const overlay = document.querySelector("#library-overlay");
    const list = document.querySelector("#documents");
    return {
      open: overlay.open,
      motionState: overlay.dataset.motionState,
      inert: overlay.inert,
      animations: overlay.getAnimations({ subtree: true }).length,
      running: overlay
        .getAnimations({ subtree: true })
        .filter((a) => a.playState === "running" || a.pending).length,
      wheelState: list.dataset.wheelState,
      motionFrames: Number(list.dataset.motionFrames || 0),
      scrollTop: list.scrollTop,
    };
  });
async function openLibrary() {
  await p.locator("[data-action=search]").click();
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "open",
  );
}
async function closeLibrary() {
  await p.locator("#library-close").click();
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "closed",
  );
}
async function selectDoc(doc) {
  await p.locator("#search").fill(doc.title);
  await p.locator('[data-id="' + doc.id + '"]').click();
  await poll(
    (title) => document.querySelector("#title").value === title,
    doc.title,
  );
  await poll(
    () =>
      !document
        .querySelector("#preview")
        .getAnimations()
        .some((a) => a.playState === "running" || a.pending),
  );
}
const contentAnimations = () =>
  p.evaluate(
    () =>
      window.libraryMotionProbe.created.filter((a) => a.target === "preview")
        .length,
  );
async function preferences(enabled) {
  await p.evaluate(
    ({ motionKeys, enabled }) => {
      const settings = JSON.parse(
        localStorage.getItem("rhine-settings") || "{}",
      );
      settings.motion = Object.fromEntries(
        motionKeys.map((key) => [key, enabled]),
      );
      settings.motionPreset = enabled ? "full" : "reduced";
      localStorage.setItem("rhine-settings", JSON.stringify(settings));
      window.dispatchEvent(new Event("rhine-motion-preferences"));
    },
    { motionKeys, enabled },
  );
}
async function stableClosed() {
  const before = await state();
  await p.waitForTimeout(250);
  const after = await state();
  assert.equal(after.motionState, "closed");
  assert.equal(after.open, false);
  assert.equal(after.running, 0);
  assert.equal(
    after.motionFrames,
    before.motionFrames,
    "closed directory has no continuing motion frames",
  );
  assert.equal(
    after.scrollTop,
    before.scrollTop,
    "closed directory does not keep scrolling",
  );
}

try {
  app = await electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: [
      "--user-data-dir=" + join(run, "profile"),
      "--disable-gpu-shader-disk-cache",
      "--use-angle=d3d11",
    ],
    timeout: 60000,
  });
  p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  p.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await poll(() => window.rhineReview?.stats().ready, null, 60000);
  const fixture = await p.evaluate(async () => {
    const firstGroup = await window.rhine.createCategory("动效分类甲");
    const secondGroup = await window.rhine.createCategory("动效分类乙");
    const first = await window.rhine.create({
      title: "动效文档甲",
      category: firstGroup.name,
      categoryId: firstGroup.id,
      body: "# 动效文档甲\n\n阅读与编辑保留同一正文。",
    });
    const second = await window.rhine.create({
      title: "动效文档乙",
      category: secondGroup.name,
      categoryId: secondGroup.id,
      body: "# 动效文档乙\n\n选择文档时播放有限过渡。",
    });
    for (let i = 0; i < 48; i++)
      await window.rhine.create({
        title: "滚动测试" + String(i).padStart(2, "0"),
        category: firstGroup.name,
        categoryId: firstGroup.id,
        body: "目录惯性滚动测试 " + i,
      });
    return { firstGroup, secondGroup, first, second };
  });
  await p.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await p.evaluate(() => window.rhineReview.archive());
  await p.waitForTimeout(1500);
  await preferences(true);
  // The editor is loaded on demand; establish its DOM before installing probes.
  await openLibrary();
  await closeLibrary();
  await p.evaluate(() => {
    const probe = (window.libraryMotionProbe = {
      created: [],
      states: [],
      axis: [],
    });
    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = originalAnimate.apply(this, args);
      if (this.closest("#library-overlay"))
        probe.created.push({
          target: this.id || this.className,
          duration: animation.effect.getTiming().duration,
        });
      return animation;
    };
    const overlay = document.querySelector("#library-overlay");
    new MutationObserver(() =>
      probe.states.push(overlay.dataset.motionState),
    ).observe(overlay, {
      attributes: true,
      attributeFilter: ["data-motion-state"],
    });
    const measure = () => {
      if (!overlay.open) return;
      const aside = overlay.querySelector("aside"),
        row = overlay.querySelector(".document");
      if (row) {
        const axis = getComputedStyle(aside, "::before"),
          tick = getComputedStyle(row, "::before");
        const asideBox = aside.getBoundingClientRect(),
          rowBox = row.getBoundingClientRect();
        probe.axis.push({
          state: overlay.dataset.motionState,
          x: asideBox.left + parseFloat(axis.left) + parseFloat(axis.width) / 2,
          y: asideBox.top + parseFloat(axis.top),
          tickX: rowBox.left + parseFloat(tick.left),
          tickY: rowBox.top + rowBox.height / 2,
        });
      }
      if (overlay.dataset.motionState === "opening")
        requestAnimationFrame(measure);
    };
    window.libraryMotionProbe.measure = measure;
  });
  await p.locator("[data-action=search]").click();
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "opening",
  );
  await p.evaluate(() => window.libraryMotionProbe.measure());
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "open",
  );
  await p.waitForTimeout(80);
  samples.open = await state();
  assert.equal(
    samples.open.running,
    0,
    "opening ends without persistent animations",
  );
  const axis = await p.evaluate(() => window.libraryMotionProbe.axis);
  assert.ok(
    axis.length > 2,
    "opening geometry sampled during actual animation",
  );
  for (const frame of axis) {
    assert.ok(
      Math.abs(frame.x - axis[0].x) < 0.3,
      "vertical axis stays fixed during opening",
    );
    assert.ok(
      Math.abs(frame.y - axis[0].y) < 0.3,
      "axis origin stays fixed during opening",
    );
    assert.ok(
      Math.abs(frame.tickX - axis[0].tickX) < 0.3,
      "tick origin stays fixed during opening",
    );
    assert.ok(
      Math.abs(frame.tickY - axis[0].tickY) < 0.3,
      "ticks do not shift during opening",
    );
    assert.ok(
      Math.abs(frame.tickX - frame.x) < 1,
      "ticks meet the vertical axis",
    );
  }
  checks.finiteOpeningAndFixedAxis = true;
  await p.screenshot({ path: join(out, "motion-open.png") });

  const beforeSelect = await contentAnimations();
  await selectDoc(fixture.first);
  const afterSelect = await contentAnimations();
  assert.ok(
    afterSelect > beforeSelect,
    "new document plays its content transition",
  );
  await p.locator('[data-id="' + fixture.first.id + '"]').click();
  await p.waitForTimeout(80);
  assert.equal(
    await contentAnimations(),
    afterSelect,
    "selecting the same document does not replay content",
  );
  await p.keyboard.press("e");
  await p.locator("#preview .tiptap").fill("草稿动效不应重播");
  await p.keyboard.type("，连续输入测试");
  assert.equal(
    await contentAnimations(),
    afterSelect,
    "typing does not replay content animations",
  );
  checks.selectionOnlyContentAnimation = true;
  await p.locator("#library-close").click();
  await p.locator("[data-choice=cancel]").click();
  assert.equal((await state()).motionState, "open");
  assert.match(
    await p.locator("#preview .tiptap").innerText(),
    /草稿动效不应重播，连续输入测试/,
  );
  assert.ok(
    await p
      .locator("#state")
      .innerText()
      .then((text) => text.includes("未保存")),
  );
  checks.dirtyCancelKeepsDraft = true;
  await p.keyboard.press("Control+s");
  await poll(() =>
    document.querySelector("#state").textContent.includes("已保存"),
  );

  await p.locator("#search").fill("动效文档");
  await p
    .locator('[data-id="' + fixture.first.id + '"] .directory-label')
    .dragTo(p.locator('[data-category-id="' + fixture.secondGroup.id + '"]'));
  await poll(
    async ({ id, category }) =>
      (await window.rhine.list()).documents.find((d) => d.id === id)
        .categoryId === category,
    { id: fixture.first.id, category: fixture.secondGroup.id },
  );
  checks.wholeRowDragStillClassifies = true;
  await p.locator("#search").fill("");
  await poll(
    () => document.querySelectorAll("#documents .document").length >= 48,
  );
  await p
    .locator("#documents")
    .evaluate(
      (el) =>
        (el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 3)),
    );
  const listBox = await p.locator("#documents").boundingBox();
  await p.mouse.move(
    listBox.x + listBox.width / 2,
    listBox.y + listBox.height / 2,
  );
  await p.mouse.wheel(0, 160);
  await poll(
    () =>
      document.querySelector("#documents").dataset.wheelState === "coasting",
  );
  const coastStart = await state();
  await p.waitForTimeout(65);
  const coastAfter = await state();
  assert.ok(
    coastAfter.scrollTop > coastStart.scrollTop + 1,
    "wheel momentum advances native scrollTop after input",
  );
  await p.mouse.move(listBox.x + 2, listBox.y + listBox.height / 2);
  await p.mouse.down();
  await p.mouse.up();
  await poll(
    () => document.querySelector("#documents").dataset.wheelState === "idle",
  );
  const stopped = await state();
  await p.waitForTimeout(150);
  assert.equal(
    (await state()).scrollTop,
    stopped.scrollTop,
    "pointer input stops ongoing momentum",
  );
  checks.nativeMomentumAndStop = true;
  await p.mouse.move(
    listBox.x + listBox.width / 2,
    listBox.y + listBox.height / 2,
  );
  await p.mouse.wheel(0, 160);
  await poll(
    () =>
      document.querySelector("#documents").dataset.wheelState === "coasting",
  );
  const closingDocumentCount = await p.evaluate(
    async () => (await window.rhine.list()).documents.length,
  );
  await p.locator("#library-close").click();
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "closing",
  );
  assert.equal((await state()).open, true, "dialog stays modal during closing");
  assert.equal((await state()).inert, true, "closing isolates input");
  await p.keyboard.press("Control+n");
  await p.keyboard.press("e");
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "closed",
  );
  await stableClosed();
  assert.equal(
    await p.evaluate(async () => (await window.rhine.list()).documents.length),
    closingDocumentCount,
    "closing shortcuts cannot enqueue hidden document operations",
  );
  assert.equal(
    await p.evaluate(() => document.activeElement?.dataset.action),
    "search",
    "close restores the opener focus",
  );
  checks.finiteClosingAndStoppedHiddenMotion = true;
  checks.closingShortcutsIsolated = true;

  await p.emulateMedia({ reducedMotion: "reduce" });
  const systemBefore = await p.evaluate(
    () => window.libraryMotionProbe.created.length,
  );
  await openLibrary();
  await selectDoc(fixture.second);
  assert.equal(
    await p.evaluate(() => window.libraryMotionProbe.created.length),
    systemBefore,
    "system reduced motion suppresses opening and content animation",
  );
  assert.equal((await state()).running, 0);
  await closeLibrary();
  await stableClosed();
  checks.systemReducedMotion = true;
  await p.emulateMedia({ reducedMotion: "no-preference" });
  await preferences(false);
  const applicationBefore = await p.evaluate(
    () => window.libraryMotionProbe.created.length,
  );
  await openLibrary();
  await selectDoc(fixture.first);
  assert.equal(
    await p.evaluate(() => window.libraryMotionProbe.created.length),
    applicationBefore,
    "application reduced settings suppress opening and content animation",
  );
  assert.equal((await state()).running, 0);
  await p.screenshot({ path: join(out, "motion-reduced.png") });
  await closeLibrary();
  await stableClosed();
  checks.applicationReducedMotion = true;
  assert.deepEqual(errors, []);
  const probe = await p.evaluate(() => ({
    states: window.libraryMotionProbe.states,
    created: window.libraryMotionProbe.created,
    axis: window.libraryMotionProbe.axis,
  }));
  await writeFile(
    join(out, "motion-result.json"),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checks, samples, probe, errors },
      null,
      2,
    ),
  );
  console.log(
    "Library finite motion, fixed ticks, content selection, draft protection, whole-row drag, native momentum and reduced settings passed.",
  );
} catch (error) {
  if (p)
    await p
      .screenshot({ path: join(out, "motion-failure.png") })
      .catch(() => {});
  await writeFile(
    join(out, "motion-result.json"),
    JSON.stringify(
      { checks, samples, errors, failure: error.stack || String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      .catch(() => {});
    await app.close().catch(() => {});
  }
}
