import {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
  shell,
  dialog,
  screen,
  Menu,
  safeStorage,
  clipboard,
  nativeImage,
} from "electron";
import { readFile, writeFile, realpath, open } from "node:fs/promises";
import {
  resolve,
  dirname,
  relative,
  isAbsolute,
  join,
  extname,
  basename,
} from "node:path";
import { Repository, inspectDocumentImage } from "./repository.mjs";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rhine",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
app.setAppUserModelId("io.github.realhc.rhinelab");
const base = app.isPackaged ? dirname(process.execPath) : app.getAppPath();
const data = join(base, "RhineLabData");
const development =
  !app.isPackaged && process.env.RHINE_DEV_URL === "http://127.0.0.1:5173";
const entry = development
  ? "http://127.0.0.1:5173/desktop.html"
  : "rhine://app/desktop.html";
let window,
  repository,
  dirty = false,
  closing = false;
let aiRuntimePromise;
function getAIRuntime() {
  // Failures in optional modules never gate startup, graphics or ordinary Markdown operations.
  if(!aiRuntimePromise)aiRuntimePromise=import("./ai-runtime.mjs").then(async({createAIRuntime})=>createAIRuntime({
    repository,isDirty:()=>dirty,
    onChanged:()=>{if(window&&!window.isDestroyed())window.webContents.send("rhine:changed");},
    encrypt:text=>{if(!safeStorage.isEncryptionAvailable())throw Error("系统密钥加密不可用，不能保存 API Key。");return safeStorage.encryptString(text).toString("base64");},
    decrypt:text=>safeStorage.decryptString(Buffer.from(text,"base64")),
  })).catch(error=>{aiRuntimePromise=undefined;throw error;});
  return aiRuntimePromise;
}
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const trusted = (event) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== entry
  )
    throw new Error("不允许的调用来源");
};
const handle = (name, callback) =>
  ipcMain.handle(`rhine:${name}`, async (event, ...args) => {
    trusted(event);
    try {
      return { ok: true, value: await callback(...args) };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code || "IO_ERROR",
      };
    }
  });
function external(value) {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("链接无效");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("只允许 HTTP / HTTPS 链接");
  return shell.openExternal(url.href);
}
function modelImageSize(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (length >= 8 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  throw Object.assign(new Error("请选择有效的 PNG 或 JPEG 图片。"), { code: "IMAGE" });
}
async function importModelImage(file) {
  const limit = 20 * 1024 * 1024;
  const handle = await open(file, "r");
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("请选择不超过 20 MB 的普通图片文件。");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit || bytesRead !== stat.size) throw new Error("图片文件过大或读取期间发生变化，请重试。");
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  const [width, height] = modelImageSize(bytes);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32000000)
    throw Object.assign(new Error("图片不能超过 3200 万像素，单边不能超过 16384 像素。"), { code: "IMAGE" });
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw Object.assign(new Error("图片无法解码，请更换图片。"), { code: "IMAGE" });
  const size = image.getSize();
  if (size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384 || size.width * size.height > 32000000)
    throw Object.assign(new Error("图片尺寸超出导入限制。"), { code: "IMAGE" });
  if (size.width > 1024 || size.height > 1024) {
    const scale = 1024 / Math.max(size.width, size.height);
    image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "best" });
  }
  return image.toPNG();
}
function verifyDocumentImage(input) {
  const info = inspectDocumentImage(input);
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw Object.assign(new Error("正文图片无法解码，请更换图片。"), { code: "IMAGE" });
  const size = image.getSize();
  if (size.width < 1 || size.height < 1 || size.width > 16384 || size.height > 16384 || size.width * size.height > 32000000 ||
      size.width * size.height !== info.width * info.height)
    throw Object.assign(new Error("正文图片尺寸无效或超出导入限制。"), { code: "IMAGE" });
  // Keep the original bytes, resolution, metadata and compression.
  return bytes;
}
async function readPickedDocumentImage(file) {
  const limit = 20 * 1024 * 1024;
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw Object.assign(new Error("请选择不超过 20 MB 的普通 PNG 或 JPEG 图片文件。"), { code: "IMAGE" });
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size)
      throw Object.assign(new Error("图片在读取期间发生变化，请重试。"), { code: "IMAGE" });
    return verifyDocumentImage(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      // Probe the actual portable directory before opening a renderer. Never redirect documents.
      try {
        const samples = JSON.parse(
            await readFile(
              join(app.getAppPath(), "content/archives.json"),
              "utf8",
            ),
          );
        repository = new Repository(data, samples.records, samples.columns);
        await repository.init();
      } catch (error) {
        dialog.showErrorBox(
          "无法打开本地知识库",
          `知识库位置：${data}\n\n${error.message}\n\n请退出后将整个程序文件夹（包含 RhineLabData）移动到可写位置，例如“文档”，再重新启动。不会将文档转存到其他位置。`,
        );
        app.quit();
        return;
      }
      const site = development
        ? app.getAppPath()
        : await realpath(join(app.getAppPath(), "release/desktop/site"));
      protocol.handle("rhine", async (request) => {
        try {
          const url = new URL(request.url);
          if (url.host !== "app" || !["GET", "HEAD"].includes(request.method))
            return new Response("Forbidden", { status: 403 });
          const file = await realpath(
            resolve(site, "." + decodeURIComponent(url.pathname)),
          );
          const rel = relative(site, file);
          if (rel.startsWith("..") || isAbsolute(rel))
            return new Response("Forbidden", { status: 403 });
          const bytes = await readFile(file);
          const mime = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
            ".ogg": "audio/ogg",
            ".glb": "model/gltf-binary",
            ".pdf": "application/pdf",
            ".txt": "text/plain; charset=utf-8",
            ".md": "text/plain; charset=utf-8",
          };
          const headers = new Headers({
            "Content-Type": mime[extname(file)] || "application/octet-stream",
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
          });
          const range = request.headers.get("range");
          if (range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!match) return new Response(null, { status: 416 });
            const start = Number(match[1]),
              end = match[2]
                ? Math.min(Number(match[2]), bytes.length - 1)
                : bytes.length - 1;
            if (start > end || start >= bytes.length)
              return new Response(null, {
                status: 416,
                headers: { "Content-Range": "bytes */" + bytes.length },
              });
            headers.set(
              "Content-Range",
              "bytes " + start + "-" + end + "/" + bytes.length,
            );
            headers.set("Content-Length", String(end - start + 1));
            return new Response(
              request.method === "HEAD" ? null : bytes.subarray(start, end + 1),
              { status: 206, headers },
            );
          }
          headers.set("Content-Length", String(bytes.length));
          return new Response(request.method === "HEAD" ? null : bytes, {
            status: 200,
            headers,
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      });
      let saved = {};
      try {
        await repository.safe(join(data, "window.json"));
        saved = JSON.parse(await readFile(join(data, "window.json"), "utf8"));
      } catch {
        /* first launch */
      }
      const bounds = {
        width: Math.max(1000, Math.min(2400, Number(saved.width) || 1440)),
        height: Math.max(680, Math.min(1600, Number(saved.height) || 900)),
      };
      if (
        Number.isFinite(saved.x) &&
        Number.isFinite(saved.y) &&
        screen
          .getAllDisplays()
          .some(
            ({ workArea: a }) =>
              saved.x >= a.x &&
              saved.y >= a.y &&
              saved.x + 160 < a.x + a.width &&
              saved.y + 80 < a.y + a.height,
          )
      )
        Object.assign(bounds, { x: saved.x, y: saved.y });
      window = new BrowserWindow({
        ...bounds,
        minWidth: 1000,
        minHeight: 680,
        title: "Rhine Lab · 本地知识库",
        backgroundColor: "#e8e5e1",
        show: false,
        icon: join(app.getAppPath(), "release/desktop/site/icons/icon-512.png"),
        webPreferences: {
          preload: join(app.getAppPath(), "desktop/preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
      });
      Menu.setApplicationMenu(null);
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      window.webContents.session.setPermissionCheckHandler(() => false);
      if (!development)
        window.webContents.session.webRequest.onBeforeRequest(
          (details, callback) =>
            callback({
              cancel:
                !details.url.startsWith("rhine://app/") &&
                !details.url.startsWith("devtools:"),
            }),
        );
      window.webContents.on("will-navigate", (event, url) => {
        if (url !== entry) event.preventDefault();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        if (
          input.key === "F5" ||
          (input.control && input.key.toLowerCase() === "r")
        ) {
          event.preventDefault();
          window.webContents.send("rhine:changed");
        }
        if (input.key === "F11") {
          event.preventDefault();
          window.setFullScreen(!window.isFullScreen());
        }
        if (input.key === "Escape" && window.isFullScreen()) {
          event.preventDefault();
          window.setFullScreen(false);
        }
      });
      for (const method of [
        "list",
        "read",
        "create",
        "save",
        "reorder",
      "createCategory",
      "renameCategory",
      "removeCategory",
      "moveDocument",
        "trash",
        "restore",
        "purge",
      ])
        handle(method, (...args) => repository[method](...args));
      handle("readModelImage", (id, expectedRef) => repository.readModelImage(id, expectedRef));
      handle("importDocumentImage", async (id, input) => {
        await repository.locate(id);
        return repository.importDocumentImage(id, verifyDocumentImage(input));
      });
      handle("pickDocumentImages", async id => {
        await repository.locate(id);
        const result = await dialog.showOpenDialog(window, {
          title: "插入正文图片",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg"] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        if (result.filePaths.length > 10)
          throw Object.assign(new Error("一次最多插入 10 张图片。"), { code: "INPUT" });
        const imported = [];
        for (const file of result.filePaths) {
          const bytes = await readPickedDocumentImage(file);
          imported.push({ ...await repository.importDocumentImage(id, bytes), name: basename(file) });
        }
        return imported;
      });
      handle("readDocumentImage", (id, src) => repository.readDocumentImage(id, src));
      const requireSavedImageEdit = () => {
        if (dirty) throw Object.assign(new Error("请先保存正文，再修改模型图片。"), { code: "DIRTY" });
      };
      handle("setModelImage", async (id, revision) => {
        requireSavedImageEdit();
        await repository.modelImageEntry(id, revision);
        const result = await dialog.showOpenDialog(window, {
          title: "选择模型图片",
          properties: ["openFile"],
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg"] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        const bytes = await importModelImage(result.filePaths[0]);
        requireSavedImageEdit();
        return repository.setModelImage(id, revision, bytes);
      });
      handle("removeModelImage", (id, revision) => {
        requireSavedImageEdit();
        return repository.removeModelImage(id, revision);
      });
      handle("openFolder", async () => {
        const error = await shell.openPath(data);
        if (error) throw new Error(error);
      });
      handle("openExternal", external);
      handle("exportPreferences", async (text) => {
        if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024)
          throw new Error("设置文件不能超过 1 MB");
        const data = JSON.parse(text);
        if (
          data?.version !== 1 ||
          !data.settings ||
          typeof data.settings !== "object" ||
          Array.isArray(data.settings) ||
          !Array.isArray(data.saved) ||
          data.saved.length > 10000 ||
          data.saved.some(
            (id) =>
              typeof id !== "string" ||
              !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id),
          )
        )
          throw new Error("设置格式无效");
        const result = await dialog.showSaveDialog(window, {
          title: "导出设置与收藏",
          defaultPath: join(base, "rhine-preferences.json"),
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (result.canceled || !result.filePath) return false;
        await writeFile(result.filePath, text, "utf8");
        return true;
      });

      handle("fullscreen", () => window.setFullScreen(!window.isFullScreen()));
      for(const name of ["state","saveSettings","test","run","cancel","semantic","guide","tasks","saveTask","removeTask","runTask","configureHTTP"])
        handle("ai:"+name,async(...args)=>(await getAIRuntime()).call(name,...args));
      handle("ai:copy",async kind=>{
        const runtime=await getAIRuntime();
        if(kind==="guide")clipboard.writeText(JSON.stringify(await runtime.call("guide"),null,2));
        else if(kind==="connection"){
          const {http}=await runtime.call("state");
          if(!http.running||!http.token)throw Error("请先启用本机 API。");
          clipboard.writeText(JSON.stringify({url:http.endpoint,token:http.token},null,2));
        } else throw Error("未知复制操作");
      });
      ipcMain.on("rhine:dirty", (event, value) => {
        try {
          trusted(event);
          dirty = value === true;
        } catch {
          /* reject */
        }
      });
      repository.watch(() => {
        if (window && !window.isDestroyed())
          window.webContents.send("rhine:changed");
      });
      window.on("close", (event) => {
        if (closing) return;
        event.preventDefault();
        if (
          dirty &&
          dialog.showMessageBoxSync(window, {
            type: "warning",
            buttons: ["继续编辑", "放弃修改并退出"],
            defaultId: 0,
            cancelId: 0,
            title: "文档尚未保存",
            message: "退出将丢弃当前未保存的修改。",
            detail: "选择继续编辑，然后按 Ctrl+S 保存。",
          }) !== 1
        ) {
          event.preventDefault();
          return;
        }
        // Bounds are preferences; failure does not affect Markdown or prevent exit.
        closing = true;
        repository
          .atomic(
            join(data, "window.json"),
            JSON.stringify(window.getNormalBounds()),
          )
          .catch(() => {})
          .finally(() => window?.destroy());
      });
      window.on("closed", () => {
        if(aiRuntimePromise)void aiRuntimePromise.then(runtime=>runtime.close()).catch(()=>{});
        repository.close();
        window = null;
      });
      window.once("ready-to-show", () => window.show());
      await window.loadURL(entry);
      // Load persisted schedules only after the normal client is usable; init itself makes no model calls.
      void getAIRuntime().catch(()=>{});
    })
    .catch((error) => {
      dialog.showErrorBox("启动失败", error.stack || error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
}
