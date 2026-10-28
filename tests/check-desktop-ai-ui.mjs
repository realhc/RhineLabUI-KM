// Exercise the packaged Electron client with a local, deterministic model API.
// Never reads the user's portable data or sends documents to a remote provider.
import { _electron as electron } from "playwright";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";

const out = resolve("verification/ai"),
  run = resolve("release/ai-ui-test", Date.now().toString()),
  portable = join(run, "portable");
await mkdir(out, { recursive: true });
await mkdir(run, { recursive: true });
await cp(resolve("release/packages/RhineLab-win32-x64"), portable, {
  recursive: true,
  filter: (source) => !source.split(/[\\/]/).includes("RhineLabData"),
});
let modelCalls = 0,
  embedCalls = 0;
const model = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const payload = JSON.parse(raw);
  let value;
  if (request.url === "/v1/embeddings") {
    embedCalls++;
    value = {
      data: payload.input.map((text, index) => ({
        index,
        embedding: /恢复|回收|误删/.test(text) ? [1, 0, 0] : [0, 1, 0],
      })),
    };
  } else {
    modelCalls++;
    const last = payload.messages.at(-1),
      user =
        payload.messages.filter((m) => m.role === "user").at(-1)?.content || "";
    const tools = payload.tools || [];
    if (
      last.role !== "tool" &&
      user.includes("CREATE_DEMO") &&
      tools.some((t) => t.function.name === "create_document")
    )
      value = {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "create-demo",
                  type: "function",
                  function: {
                    name: "create_document",
                    arguments: JSON.stringify({
                      title: "AI界面生成",
                      categoryId: null,
                      body: "# AI演示\n\n保留原有知识库功能。",
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
    else
      value = {
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "## 本地模型总结\n\n- 原始文档仍保存在本地。\n- 引用与操作记录可以核对。",
            },
          },
        ],
      };
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${model.address().port}/v1`;
let app, p;
const errors = [],
  remoteRequests = [],
  checks = {};
const poll = async (fn, arg, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await p.evaluate(fn, arg)) return;
    await p.waitForTimeout(50);
  }
  throw Error("State timeout: " + fn);
};
try {
  app = await electron.launch({
    executablePath: join(portable, "RhineLab.exe"),
    args: ["--user-data-dir=" + join(run, "profile")],
    timeout: 60000,
  });
  p = await app.firstWindow();
  p.setDefaultTimeout(20000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (/^https?:/.test(r.url())) remoteRequests.push(r.url());
  });
  await poll(() => window.rhineReview?.stats().ready);
  await p.locator(".entry-start").click();
  await poll(() => window.rhineReview.stats().startup === "started");
  await p.evaluate(() => window.rhineReview.archive());
  await p.locator("[data-action=search]").click();
  await poll(
    () =>
      document.querySelector("#library-overlay")?.dataset.motionState ===
      "open",
  );
  const initial = await p.evaluate(() => window.rhineAI.state());
  assert.equal(initial.settings.enabled, false);
  assert.equal(initial.http.enabled, false);
  assert.equal(modelCalls, 0);
  assert.equal(embedCalls, 0);
  checks.offlineStartup = true;
  const docs = await p.evaluate(async () => {
    const a = await window.rhine.create({
      title: "回收与恢复",
      category: "未分类",
      categoryId: null,
      body: "# 操作\n\n误删记录可从回收区恢复。\n\n再次恢复时先检查版本。",
    });
    const b = await window.rhine.create({
      title: "另一份资料",
      category: "未分类",
      categoryId: null,
      body: "恢复后继续编辑，并保留备份。",
    });
    return [a, b];
  });
  await p.locator("#refresh").click();
  await p.locator("#search").fill("恢复 回收");
  await poll(
    (id) => !!document.querySelector(`[data-id="${id}"] .search-snippet`),
    docs[0].id,
  );
  assert.equal(await p.locator(`[data-id="${docs[1].id}"]`).count(), 0);
  assert((await p.locator(`[data-id="${docs[0].id}"] mark`).count()) > 0);
  await p.locator(`[data-id="${docs[0].id}"]`).click();
  await poll(() => !document.querySelector("#search-position").hidden);
  assert(await p.evaluate(() => CSS.highlights.has("rhine-search")));
  checks.searchAndHighlight = true;
  await p.locator("#save").click();
  assert(await p.locator("#search-position").isHidden());
  await p.locator("#preview .tiptap").fill("未保存草稿必须保留。");
  await p.evaluate(() =>
    window.rhineAI.configureHTTP({ enabled: true, allowWrite: true }),
  );
  const httpState = (await p.evaluate(() => window.rhineAI.state())).http;
  const httpTool = async (name, args, token = httpState.token) => {
    const r = await fetch(`${httpState.endpoint}/tools/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    return { status: r.status, body: await r.json() };
  };
  const dirtyWrite = await httpTool("create_document", {
    title: "不应写入",
    categoryId: null,
    body: "blocked",
  });
  assert.equal(dirtyWrite.status, 409);
  checks.draftProtection = true;
  await p.locator("#save").click();
  await poll(() =>
    document.querySelector("#state").textContent.includes("已保存"),
  );
  const unauthorized = await httpTool("list_documents", {}, "wrong");
  assert.equal(unauthorized.status, 401);
  const listing = await httpTool("list_documents", {});
  assert.equal(listing.status, 200);
  checks.externalAPI = true;
  await p.locator("#ai-open").click();
  await poll(() => document.querySelector("#ai-workspace")?.open);
  await p.locator('[data-ai-tab="connect"]').click();
  await p.locator("#ai-enabled").check();
  await p.locator("#ai-base").fill(baseUrl);
  await p.locator("#ai-model").fill("test-chat");
  await p.locator("#ai-embedding").fill("test-embedding");
  await p.locator("#ai-key").fill("isolated-test-key");
  await p.locator('#ai-settings button[type="submit"]').click();
  await poll(() =>
    document.querySelector("#ai-status").textContent.includes("接入设置已保存"),
  );
  assert.equal(await p.locator("#ai-key").inputValue(), "");
  const stored = await readFile(
    join(portable, "RhineLabData", "ai", "settings.json"),
    "utf8",
  );
  assert(!stored.includes("isolated-test-key"));
  checks.encryptedKey = true;
  await p.locator("#ai-test").click();
  await poll(
    () => document.querySelector("#ai-status").textContent === "连接正常。",
  );
  await p.locator('[data-ai-tab="chat"]').click();
  await p.locator("#ai-summary").click();
  await p.locator("#ai-send").click();
  await poll(
    () => document.querySelector("#ai-status").textContent === "本次执行完成。",
  );
  assert((await p.locator("#ai-answer").innerText()).includes("本地模型总结"));
  checks.summary = true;
  await p.locator("#ai-prompt").fill("CREATE_DEMO 请创建演示文档");
  await p.locator("#ai-write").check();
  await p.locator("#ai-send").click();
  await poll(
    () => document.querySelector("#ai-status").textContent === "本次执行完成。",
  );
  assert(
    (await p.evaluate(() => window.rhine.list())).documents.some(
      (d) => d.title === "AI界面生成",
    ),
  );
  checks.aiCreate = true;
  await p.locator('[data-ai-tab="tasks"]').click();
  await p.locator("#ai-task-title").fill("每日回顾");
  await p
    .locator("#ai-task-prompt")
    .fill("根据已有资料生成简短总结，不修改已有文档。");
  await p.locator("#ai-task-enabled").uncheck();
  await p.locator('#ai-task-form button[type="submit"]').click();
  await poll(() =>
    document.querySelector("#ai-status").textContent.includes("任务已保存"),
  );
  const tasks = await p.evaluate(() => window.rhineAI.tasks());
  assert(tasks.some((t) => t.title === "每日回顾"));
  await p
    .locator(".ai-task-row")
    .filter({ hasText: "每日回顾" })
    .getByText("立即运行", { exact: true })
    .click();
  await poll(() =>
    document.querySelector("#ai-status").textContent.includes("任务已执行"),
  );
  assert(
    (await p.evaluate(() => window.rhineAI.tasks())).find(
      (t) => t.title === "每日回顾",
    ).lastDocId,
  );
  checks.taskUI = true;
  await p.locator('[data-ai-tab="guide"]').click();
  assert(
    (await p.locator("#ai-guide-text").innerText()).includes("create_document"),
  );
  checks.guide = true;
  await p.locator("#ai-close").click();
  await p.locator("#search").fill("找回误删");
  await p.locator("#search-semantic").click();
  await poll(() =>
    document.querySelector("#search-status").textContent.includes("语义匹配"),
  );
  assert(embedCalls > 0);
  assert(await p.locator(`[data-id="${docs[0].id}"]`).count());
  checks.semantic = true;
  await p.screenshot({ path: join(out, "search.png") });
  await p.locator("#ai-open").click();
  await p.locator('[data-ai-tab="tasks"]').click();
  await p.screenshot({ path: join(out, "tasks.png") });
  await p.locator("#ai-close").click();
  await p.locator("#search").fill("");
  await p.locator(`[data-id="${docs[0].id}"]`).click();
  assert.equal(await p.locator("#save").innerText(), "保存");
  await p.locator(`[data-id="${docs[1].id}"]`).click();
  await poll(() => document.querySelector("#save").textContent === "编辑");
  checks.editingPreserved = true;
  const fixture=await p.evaluate(async()=>{
    const low=await window.rhine.createCategory("搜索弱命中"),high=await window.rhine.createCategory("搜索精确命中");
    await window.rhine.create({title:"弱命中",category:low.name,categoryId:low.id,body:"alpha beta"});
    const doc=await window.rhine.create({title:"alpha beta",category:high.name,categoryId:high.id,body:"alpha\n\nbeta\n\nalpha **beta**"});
    return {low:low.id,high:high.id,doc};
  });
  await p.locator("#refresh").click();await p.locator(`[data-id="${fixture.doc.id}"]`).waitFor({state:"attached"});await p.locator("#search").fill("alpha beta");
  const firstCategory=await p.locator("#documents .category-group").first().getAttribute("data-drop-category");
  assert.equal(firstCategory,fixture.high);checks.categoryRelevance=true;
  await p.locator(`[data-id="${fixture.doc.id}"]`).click();
  await p.locator("#search").fill("alphabeta");assert(await p.locator("#search-position").isHidden());
  await p.locator("#search").fill('"alpha beta"');
  await poll(()=>CSS.highlights.get("rhine-search")?.size===1);
  await p.evaluate(async id=>{const doc=await window.rhine.read(id);await window.rhine.save({...doc,body:"alpha\n\nbeta\n\n**alpha** beta"});},fixture.doc.id);
  await p.locator("#refresh").click();
  await poll(()=>{const ranges=[...CSS.highlights.get("rhine-search")||[]];return ranges.length===1&&ranges.every(r=>r.startContainer.isConnected&&r.endContainer.isConnected);});
  checks.highlightBlocksAndRebuild=true;
  await p.locator("#ai-open").click();await p.locator('[data-ai-tab="guide"]').click();await p.locator("#ai-copy-guide").click();
  await poll(()=>document.querySelector("#ai-status").textContent==="AI 指引已复制。");
  assert((await app.evaluate(({clipboard})=>clipboard.readText())).includes("read_document"));checks.nativeClipboard=true;
  await p.locator("#ai-close").click();
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  await writeFile(
    join(out, "native-ui.json"),
    JSON.stringify(
      {
        checks,
        modelCalls,
        embedCalls,
        pageErrors: errors,
        rendererRemoteRequests: remoteRequests,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Native AI/search UI passed: " + JSON.stringify(checks));
} finally {
  if (app) await app.close().catch(() => {});
  await new Promise((resolve) => model.close(resolve));
}
