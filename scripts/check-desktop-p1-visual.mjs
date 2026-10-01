import { _electron as electron } from "playwright";
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, extname } from "node:path";
import assert from "node:assert/strict";
const out = resolve(
    process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
      "verification/p1/visual",
  ),
  run = resolve("release/p1-visual", Date.now().toString()),
  portable = join(run, "portable"),
  webRoot = resolve("dist");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes("RhineLabData"),
});
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = resolve(webRoot, "." + (name === "/" ? "/index.html" : name));
    if (!file.startsWith(webRoot + "\\")) throw Error("Path");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url =
  "http://127.0.0.1:" + server.address().port + "/?review=1&freeze=1&time=4";
async function poll(p, fn, arg) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await p.evaluate(fn, arg)) return;
    await p.clock.runFor(16);
    await p.waitForTimeout(80);
  }
  console.error(
    await p
      .locator(".viewer-loading")
      .innerText()
      .catch(() => ""),
  );
  throw Error("Visual state timeout " + fn);
}
const matrix = [],
  faults = [];
let app;
try {
  for (const dpi of [1, 1.5, 2]
    .filter((d) => !process.argv.includes("--middle") || d === 1.5)
    .filter((d) => !process.argv.includes("--quick") || d === 1)
    .filter((d) => !process.argv.includes("--last") || d === 2))
    for (const theme of ["light", "dark"]
      .filter((t) => !process.argv.includes("--middle") || t === "light")
      .filter((t) => !process.argv.includes("--quick") || t === "light")
      .filter((t) => !process.argv.includes("--last") || t === "dark")) {
      const key = theme + "-dpi" + dpi;
      app = await electron.launch({
        executablePath: join(portable, "RhineLab.exe"),
        args: [
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--disable-gpu-shader-disk-cache",
          "--use-angle=d3d11",
          "--force-device-scale-factor=" + dpi,
          "--user-data-dir=" + join(run, key),
        ],
        timeout: 60000,
      });
      const desktop = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
      );
      const opening = app.waitForEvent("window");
      await app.evaluate(({ BrowserWindow }, url) => {
        const w = new BrowserWindow({
          width: 1440,
          height: 900,
          useContentSize: true,
          webPreferences: {
            partition: "p1-web",
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        void w.loadURL(url);
      }, url);
      const web = await opening;
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => {
          w.setContentSize(1440, 900);
          w.webContents.setBackgroundThrottling(false);
        }),
      );
      await desktop.clock.install({ time: new Date("2026-10-01T00:00:00Z") });
      await desktop.clock.pauseAt(new Date("2026-10-01T00:01:00Z"));
      for (const p of [desktop, web]) {
        p.on("console", (m) => {
          if (
            m.type() === "error" &&
            m.text().startsWith("Model viewer failed")
          )
            console.error(key, p === desktop ? "desktop" : "web", m.text());
        });
        p.on("pageerror", (e) => faults.push({ key, message: e.message }));
        await p.addInitScript(
          ({ theme }) => {
            localStorage.setItem(
              "rhine-settings",
              JSON.stringify({ colorTheme: theme, sound: false, music: false }),
            );
            const BaseParams = URLSearchParams;
            window.URLSearchParams = class extends BaseParams {
              constructor(value) {
                super(
                  value === location.search
                    ? value + "&review=1&freeze=1&time=4"
                    : value,
                );
              }
            };
          },
          { theme },
        );
        await p.reload();
        await poll(
          p,
          () => (window.rhineReview ?? window.rhine)?.stats?.().ready,
        );
        assert.equal(await p.evaluate(() => devicePixelRatio), dpi);
      }
      await desktop.clock.runFor(1000);
      async function capture(state) {
        if (state.startsWith("viewer"))
          for (const p of [web, desktop])
            await poll(p, () =>
              document
                .querySelector(".model-viewer")
                .getAnimations({ subtree: true })
                .every(
                  (a) => a.playState === "finished" || a.playState === "idle",
                ),
            );

        const geometries = [];
        const stats = [];
        for (const p of [web, desktop]) {
          geometries.push(
            await p.evaluate(() =>
              Object.fromEntries(
                [
                  ".brand",
                  ".system-nav",
                  ".archive-callout",
                  ".archive-navigation",
                  ".column-navigation",
                  ".system-footer",
                  "#three-scene",
                  ".back-button",
                  ".object-caption",
                  ".detail-content",
                  ".viewer-header",
                  ".viewer-actions",
                  ".viewer-canvas",
                ].map((sel) => {
                  const e = document.querySelector(sel),
                    r = e?.getBoundingClientRect();
                  return [
                    sel,
                    r
                      ? { x: r.x, y: r.y, width: r.width, height: r.height }
                      : null,
                  ];
                }),
              ),
            ),
          );
          stats.push(
            await p.evaluate(() => ({
              time: performance.now(),
              scene: (window.rhineReview ?? window.rhine).stats(),
              viewer: JSON.parse(
                document.querySelector(".model-viewer")?.dataset.stats ??
                  "null",
              ),
            })),
          );
        }
        for (const [sel, box] of Object.entries(geometries[0])) {
          if (!box) continue;
          for (const field of ["x", "y", "width", "height"])
            assert(
              Math.abs(box[field] - geometries[1][sel][field]) < 0.6,
              key +
                " " +
                state +
                " " +
                sel +
                " " +
                field +
                " " +
                box[field] +
                " vs " +
                geometries[1][sel][field],
            );
        }
        const masks = await web.evaluate(
          (state) =>
            [
              ".system-footer",
              ...(state === "detail" ? ["#tab-panel", ".detail-actions"] : []),
              ...(state.startsWith("viewer") ? [".viewer-heading"] : []),
            ].flatMap((sel) => {
              const e = document.querySelector(sel);
              if (!e) return [];
              const r = e.getBoundingClientRect();
              return [{ x: r.x, y: r.y, width: r.width, height: r.height }];
            }),
          state,
        );
        const shots = Promise.all([
          web.screenshot({ timeout: 60000 }),
          desktop.screenshot({ timeout: 60000 }),
        ]);
        await desktop.clock.runFor(16);
        const [a, b] = await shots;
        const diff = await app.evaluate(
          ({ nativeImage }, { a, b, masks, dpi }) => {
            let first = nativeImage.createFromBuffer(Buffer.from(a, "base64")),
              second = nativeImage.createFromBuffer(Buffer.from(b, "base64"));
            const rawWebSize = first.getSize(),
              rawDesktopSize = second.getSize();
            if (
              Math.abs(rawWebSize.width - rawDesktopSize.width) > 1 ||
              Math.abs(rawWebSize.height - rawDesktopSize.height) > 1
            )
              throw Error("Screenshot size differs beyond DPI rounding");
            const size = {
              width: Math.min(rawWebSize.width, rawDesktopSize.width),
              height: Math.min(rawWebSize.height, rawDesktopSize.height),
            };
            first = first.crop({ x: 0, y: 0, ...size });
            second = second.crop({ x: 0, y: 0, ...size });
            const x = first.toBitmap(),
              y = second.toBitmap();
            let sum = 0,
              n = 0,
              changed = 0;
            for (let row = 0; row < size.height; row++)
              for (let col = 0; col < size.width; col++) {
                if (
                  masks.some(
                    (r) =>
                      col / dpi >= r.x &&
                      col / dpi < r.x + r.width &&
                      row / dpi >= r.y &&
                      row / dpi < r.y + r.height,
                  )
                )
                  continue;
                const i = (row * size.width + col) * 4;
                const d = Math.max(
                  Math.abs(x[i] - y[i]),
                  Math.abs(x[i + 1] - y[i + 1]),
                  Math.abs(x[i + 2] - y[i + 2]),
                );
                sum +=
                  Math.abs(x[i] - y[i]) +
                  Math.abs(x[i + 1] - y[i + 1]) +
                  Math.abs(x[i + 2] - y[i + 2]);
                n++;
                if (d > 16) changed++;
              }
            return {
              size,
              rawWebSize,
              rawDesktopSize,
              meanChannelDifference: sum / (n * 3),
              changedPixelPercent: (changed / n) * 100,
              maskedRegions: masks,
              previewWeb: first
                .resize({ width: Math.round(size.width / dpi) })
                .toPNG()
                .toString("base64"),
              previewDesktop: second
                .resize({ width: Math.round(size.width / dpi) })
                .toPNG()
                .toString("base64"),
            };
          },
          { a: a.toString("base64"), b: b.toString("base64"), masks, dpi },
        );
        await writeFile(
          join(out, key + "-" + state + "-web.png"),
          Buffer.from(diff.previewWeb, "base64"),
        );
        await writeFile(
          join(out, key + "-" + state + "-desktop.png"),
          Buffer.from(diff.previewDesktop, "base64"),
        );
        delete diff.previewWeb;
        delete diff.previewDesktop;
        assert(
          Math.abs(stats[0].time - stats[1].time) < 0.01,
          key + " " + state + " animation time",
        );
        assert(
          diff.meanChannelDifference <= 2,
          key + " " + state + " mean pixel difference",
        );
        assert(
          diff.changedPixelPercent <= 0.2,
          key + " " + state + " changed pixels",
        );
        matrix.push({
          key,
          state,
          dpi,
          theme,
          matchingGeometry: true,
          webStats: stats[0],
          desktopStats: stats[1],
          diff,
        });
        await writeFile(
          join(out, "result.json"),
          JSON.stringify(
            {
              viewport: { width: 1440, height: 900 },
              thresholds: {
                meanChannelDifference: 2,
                changedPixelPercent: 0.2,
                changedChannelThreshold: 16,
              },
              matrix,
              faults,
            },
            null,
            2,
          ) + "\n",
        );
        console.log(
          key +
            " " +
            state +
            " " +
            JSON.stringify({
              mean: diff.meanChannelDifference,
              percent: diff.changedPixelPercent,
            }),
        );
      }
      for (const time of [4, 14, 24, 32]) {
        for (const p of [web, desktop]) {
          await p.evaluate(
            (time) =>
              window.postMessage({ type: "rhine-review-frame", time }, "*"),
            time,
          );
          await poll(
            p,
            (time) =>
              Math.abs(
                (window.rhineReview ?? window.rhine).stats().bootTime -
                  (time + 5),
              ) < 0.01,
            time,
          );
        }
        await desktop.clock.runFor(350);
        await capture("boot" + time);
      }
      for (const p of [web, desktop])
        await p.evaluate(() => (window.rhineReview ?? window.rhine).archive());
      await desktop.clock.runFor(5000);
      await capture("archive");
      for (const p of [web, desktop])
        await p.evaluate(() => (window.rhineReview ?? window.rhine).detail());
      await desktop.clock.runFor(5000);
      await capture("detail");
      await desktop.clock.resume();
      for (const p of [web, desktop])
        await p.locator("[data-action=model-viewer]").click();
      for (const p of [web, desktop]) {
        const end = Date.now() + 60000;
        while (
          !(await p.evaluate(
            () =>
              JSON.parse(
                document.querySelector(".model-viewer").dataset.stats ?? "{}",
              ).ready,
          ))
        ) {
          if (Date.now() > end) {
            const diagnostics = await p.evaluate(() => ({
              health: (window.rhineReview ?? window.rhine).stats(),
              viewer: document.querySelector(".model-viewer")?.dataset.stats,
              message: document.querySelector(".viewer-loading")?.innerText,
              hidden: document.hidden,
            }));
            throw Error(
              "Viewer native loading timeout: " +
                p.url() +
                " " +
                JSON.stringify(diagnostics),
            );
          }
          await p.waitForTimeout(80);
        }
      }
      const pause = await desktop.evaluate(() => Date.now() + 1000);
      await desktop.clock.pauseAt(new Date(pause));
      await desktop.clock.runFor(2000);
      await capture("viewer-clear");
      for (const p of [web, desktop])
        await p.locator("[data-viewer=frosted]").click();
      await desktop.clock.runFor(2000);
      await capture("viewer-frosted");
      for (const p of [web, desktop])
        await p.locator("[data-viewer=explode]").click();
      await desktop.clock.runFor(4000);
      await capture("viewer-exploded");
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      );
      await app.close();
      app = null;
    }
  assert.deepEqual(faults, []);
  assert.equal(
    matrix.length,
    process.argv.includes("--quick") ||
      process.argv.includes("--last") ||
      process.argv.includes("--middle")
      ? 9
      : 54,
  );
  await writeFile(
    join(out, "result.json"),
    JSON.stringify(
      {
        viewport: { width: 1440, height: 900 },
        thresholds: {
          meanChannelDifference: 2,
          changedPixelPercent: 0.2,
          changedChannelThreshold: 16,
        },
        renderer: "ANGLE D3D11, shader disk cache disabled",
        screenshotScale: "device; evidence resized to CSS width",
        matrix,
        faults,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    )
    .catch(() => {});
  await app?.close().catch(() => {});
  await new Promise((r) => server.close(r));
}
