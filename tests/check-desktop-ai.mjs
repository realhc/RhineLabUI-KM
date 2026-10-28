// Integration checks use a disposable library and an in-process compatible
// provider. No personal data, network model or real API credential is needed.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { Repository } from "../desktop/repository.mjs";
import { createAIService, normalizeAIBaseURL } from "../desktop/ai-service.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "rhine-ai-check-"));
const repository = new Repository(root);
let dirty = false,
  changes = 0,
  service,
  reloaded;
const calls = [],
  pendingSockets = new Set();
let responseMode = "normal",
  scripted = [],
  notifyRequest;
const encrypt = (text) =>
  Buffer.from(`mock-cipher:${[...text].reverse().join("")}`).toString("base64");
const decrypt = (cipher) =>
  [
    ...Buffer.from(cipher, "base64")
      .toString()
      .replace(/^mock-cipher:/, ""),
  ]
    .reverse()
    .join("");
const message = (content, toolCalls) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
    },
  ],
});
const call = (name, args, id = `call-${Date.now()}`) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  calls.push({
    path: request.url,
    payload,
    authorization: request.headers.authorization,
  });
  notifyRequest?.({ path: request.url, payload });
  if (responseMode === "hang" && request.url.endsWith("chat/completions"))
    return;
  if (responseMode === "embedding-hang" && request.url.endsWith("embeddings"))
    return;
  if (responseMode === "redirect") {
    response.writeHead(307, { location: "https://example.invalid/key-theft" });
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.url.endsWith("embeddings")) {
    response.end(
      JSON.stringify({
        data: payload.input.map((text, index) => ({
          index,
          embedding: [
            /(恢复|回收|恢复备份)/.test(text) ? 1 : 0,
            /(搜索|检索)/.test(text) ? 1 : 0,
            0.1,
          ],
        })),
      }),
    );
  } else if (scripted.length) {
    const item = scripted.shift();
    if (item === "hang") return;
    response.end(JSON.stringify(item));
  } else response.end(JSON.stringify(message("OK")));
});
server.on("connection", (socket) => {
  pendingSockets.add(socket);
  socket.on("close", () => pendingSockets.delete(socket));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const expectCode = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
const write = { allowWrite: true };
try {
  await repository.init();
  service = await createAIService({
    repository,
    isDirty: () => dirty,
    onChanged: () => {
      changes++;
    },
    encrypt,
    decrypt,
  });
  await service.init();
  assert.equal(calls.length, 0, "init must be offline");
  assert.equal(service.getSettings().enabled, false);
  await expectCode(service.run({ prompt: "总结" }), "AI_DISABLED");
  assert.deepEqual(
    (await service.executeTool("list_documents", {})).documents,
    [],
    "offline tools work without AI",
  );
  await expectCode(
    service.executeTool("create_document", { title: "未经许可", body: "x" }),
    "WRITE_DISABLED",
  );
  dirty = true;
  await expectCode(
    service.executeTool(
      "create_document",
      { title: "草稿不能覆盖", body: "x" },
      write,
    ),
    "DIRTY",
  );
  dirty = false;
  await expectCode(
    service.executeTool("read_document", { id: "../secret" }),
    "INVALID_ID",
  );
  await expectCode(
    service.executeTool("read_document", { id: "x", path: "C:/secret" }),
    "INPUT",
  );
  for (const url of [
    "http://example.com/v1",
    "ftp://127.0.0.1/v1",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/#fragment",
  ])
    assert.throws(
      () => normalizeAIBaseURL(url),
      (error) => error.code === "INPUT",
    );
  assert.equal(normalizeAIBaseURL(baseUrl + "/chat/completions"), baseUrl);
  assert.equal(
    normalizeAIBaseURL("http://[::1]:11434/v1/"),
    "http://[::1]:11434/v1",
  );

  let categories = await service.executeTool("list_categories", {});
  const createdCategory = await service.executeTool(
    "create_category",
    { name: "研究", directoryRevision: categories.directoryRevision },
    write,
  );
  await expectCode(
    service.executeTool(
      "create_category",
      { name: "冲突分类", directoryRevision: categories.directoryRevision },
      write,
    ),
    "CONFLICT",
  );
  const recovery = await service.executeTool(
    "create_document",
    {
      title: "回收区恢复",
      body: "# 资料恢复\n\n文档可以从回收区恢复。",
      categoryId: createdCategory.category.id,
    },
    write,
  );
  const searchDoc = await service.executeTool(
    "create_document",
    { title: "搜索检索教程", body: "# 搜索\n\n关键词与正文定位。" },
    write,
  );
  const searchResult = await service.executeTool("search_documents", {
    query: "恢复",
  });
  assert.equal(searchResult.hits[0].id, recovery.id);
  const original = await service.executeTool("read_document", {
    id: recovery.id,
  });
  assert.equal(original.contentType, "untrusted_document");
  const revised = await service.executeTool(
    "update_document",
    {
      id: recovery.id,
      expectedRevision: original.revision,
      body: original.body + "\n恢复前保留备份。",
    },
    write,
  );
  await expectCode(
    service.executeTool(
      "update_document",
      {
        id: recovery.id,
        expectedRevision: original.revision,
        body: "错误覆盖",
      },
      write,
    ),
    "CONFLICT",
  );
  assert.ok((await repository.read(recovery.id)).body.includes("保留备份"));
  const trashed = await service.executeTool(
    "delete_document",
    { id: searchDoc.id, expectedRevision: searchDoc.revision },
    write,
  );
  await expectCode(
    service.executeTool("read_document", { id: searchDoc.id }),
    "NOT_FOUND",
  );
  const trashRead = await service.executeTool("read_document", {
    id: searchDoc.id,
    trash: true,
  });
  await expectCode(
    service.executeTool(
      "restore_document",
      { id: searchDoc.id, expectedRevision: "0".repeat(64) },
      write,
    ),
    "CONFLICT",
  );
  await service.executeTool(
    "restore_document",
    { id: searchDoc.id, expectedRevision: trashRead.revision },
    write,
  );
  assert.equal(trashed.trash, true);
  categories = await service.executeTool("list_categories", {});
  await service.executeTool(
    "update_category",
    {
      id: createdCategory.category.id,
      name: "研究记录",
      directoryRevision: categories.directoryRevision,
    },
    write,
  );
  assert.equal((await repository.read(recovery.id)).category, "研究记录");
  categories = await service.executeTool("list_categories", {});
  await service.executeTool(
    "delete_category",
    {
      id: createdCategory.category.id,
      directoryRevision: categories.directoryRevision,
    },
    write,
  );
  assert.equal((await repository.read(recovery.id)).categoryId, null);
  assert.equal(
    (await repository.list()).documents.length,
    2,
    "deleting category preserves documents",
  );
  assert.ok(changes >= 8);

  const unencrypted = await createAIService({ repository });
  await expectCode(
    unencrypted.saveSettings({ apiKey: "must-not-persist" }),
    "AI_ENCRYPTION",
  );
  await unencrypted.close();
  const secret = "mock-private-token-12345";
  await service.saveSettings({
    enabled: true,
    baseUrl,
    model: "test-chat",
    embeddingModel: "test-embedding",
    apiKey: secret,
  });
  const disk = await fs.readFile(
    path.join(root, "ai", "settings.json"),
    "utf8",
  );
  assert.ok(!disk.includes(secret), "plaintext key must not be written");
  assert.ok(
    !JSON.stringify(service.getSettings()).includes(secret),
    "public settings never reveal key",
  );
  assert.equal(service.getSettings().hasKey, true);
  assert.deepEqual(await service.testConnection(), {
    ok: true,
    model: "test-chat",
  });
  assert.equal(calls.at(-1).authorization, `Bearer ${secret}`);

  // A model may still attempt a write when that tool was not advertised.
  scripted = [
    message(null, [
      call("create_document", { title: "禁止模型写入", body: "不能落盘" }),
    ]),
    message("已拒绝"),
  ];
  const refused = await service.run({ prompt: "查阅文档", allowWrite: false });
  assert.equal(refused.toolResults[0].result.error.code, "WRITE_DISABLED");
  assert.ok(
    !(await repository.list()).documents.some(
      (d) => d.title === "禁止模型写入",
    ),
  );
  const firstAgentRequest = calls
    .filter((item) => item.path.endsWith("chat/completions"))
    .at(-2);
  assert.ok(
    firstAgentRequest.payload.tools.every(
      (item) => item.function.name !== "create_document",
    ),
  );

  scripted = [
    message(null, [call("search_documents", { query: "恢复" }, "search-1")]),
    message("可以恢复文档。"),
  ];
  const summary = await service.run({
    prompt: "总结恢复规则",
    documentId: recovery.id,
  });
  assert.ok(summary.references.some((ref) => ref.id === recovery.id));
  const sourceRequest = calls
    .filter((item) => item.path.endsWith("chat/completions"))
    .at(-2);
  assert.ok(sourceRequest.payload.messages[1].content.includes("不可信资料"));
  assert.equal(sourceRequest.payload.messages[1].role, "user");
  scripted = [];
  await service.run({
    prompt: "只总结所选文档",
    documentIds: [recovery.id],
    tools: false,
  });
  assert.equal(
    calls.at(-1).payload.tools,
    undefined,
    "scheduled pure generation has no agent tools",
  );

  let scheduleWrites = 0;
  service.registerTools([
    {
      definition: {
        type: "function",
        function: {
          name: "create_task",
          description: "测试扩展",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      },
      mutates: true,
      execute: () => {
        scheduleWrites++;
        return { ok: true };
      },
    },
  ]);
  await expectCode(
    service.executeTool("create_task", { name: "未许可" }),
    "WRITE_DISABLED",
  );
  await service.executeTool("create_task", { name: "已许可" }, write);
  assert.equal(scheduleWrites, 1);
  assert.ok(
    service.guide().tools.some((item) => item.function.name === "create_task"),
  );

  // Cache reuse: same query embeds only the query, a changed document only itself.
  const embeddingCount = () =>
    calls.filter((item) => item.path.endsWith("embeddings")).length;
  const before = embeddingCount();
  const semantic = await service.semanticSearch({ query: "恢复备份" });
  assert.equal(semantic[0].id, recovery.id);
  const indexed = embeddingCount();
  assert.equal(indexed - before, 3);
  await service.semanticSearch({ query: "搜索检索" });
  assert.equal(embeddingCount() - indexed, 1);
  const warmCacheBefore = (
    await fs.stat(path.join(root, "ai", "embeddings.json"))
  ).mtimeMs;
  await service.semanticSearch({ query: "第二次搜索" });
  assert.equal(
    (await fs.stat(path.join(root, "ai", "embeddings.json"))).mtimeMs,
    warmCacheBefore,
    "warm query must not rewrite derived cache",
  );
  const read = await repository.read(recovery.id);
  await service.executeTool(
    "update_document",
    {
      id: recovery.id,
      expectedRevision: read.revision,
      body: read.body + "\n新的恢复说明",
    },
    write,
  );
  const beforeEditSearch = embeddingCount();
  await service.semanticSearch({ query: "恢复" });
  assert.equal(embeddingCount() - beforeEditSearch, 2);
  reloaded = await createAIService({ repository, encrypt, decrypt });
  await reloaded.init();
  assert.equal(reloaded.getSettings().hasKey, true);
  const reloadCount = embeddingCount();
  await reloaded.semanticSearch({ query: "恢复" });
  assert.equal(
    embeddingCount() - reloadCount,
    1,
    "persisted hash/model cache reuses vectors",
  );
  await reloaded.close();
  reloaded = null;

  let resolveEmbedding;
  const embeddingStarted = new Promise((resolve) => {
    resolveEmbedding = resolve;
  });
  notifyRequest = ({ path: route }) => {
    if (route.endsWith("embeddings")) resolveEmbedding();
  };
  responseMode = "embedding-hang";
  const indexing = service.semanticSearch({ query: "取消语义搜索" });
  await embeddingStarted;
  await expectCode(
    service.saveSettings({ embeddingModel: "changed-mid-index" }),
    "BUSY",
  );
  assert.equal(service.getSettings().busy, true);
  service.cancel();
  await expectCode(indexing, "CANCELLED");
  assert.equal(service.getSettings().busy, false);
  responseMode = "normal";
  notifyRequest = null;

  // Read-only contexts also reject malicious late write attempts and an active
  // draft takes precedence even when the model has explicit write permission.
  scripted = [
    message(null, [
      call("create_document", { title: "不能影响草稿", body: "x" }),
    ]),
    message("请先保存草稿"),
  ];
  dirty = true;
  const dirtyRun = await service.run({
    prompt: "帮我创建文档",
    allowWrite: true,
  });
  assert.equal(dirtyRun.toolResults[0].result.error.code, "DIRTY");
  dirty = false;
  assert.ok(
    !(await repository.list()).documents.some(
      (doc) => doc.title === "不能影响草稿",
    ),
  );

  // A provider repeatedly requesting tools cannot create an infinite agent.
  scripted = Array.from({ length: 8 }, (_, index) =>
    message(null, [call("list_documents", {}, `loop-${index}`)]),
  );
  await assert.rejects(
    service.run({ prompt: "循环测试" }),
    (error) => error.code === "AI_LIMIT" && error.toolResults.length === 8,
  );
  assert.equal(scripted.length, 0);

  responseMode = "redirect";
  await expectCode(service.testConnection(), "AI_REQUEST");
  responseMode = "normal";

  // Cancellation reports earlier writes instead of pretending they were undone.
  scripted = [
    message(null, [
      call(
        "create_document",
        { title: "取消前已写入", body: "保持真实操作结果。" },
        "write-before-cancel",
      ),
    ]),
    "hang",
  ];
  let resolveHung;
  const hungRequest = new Promise((resolve) => {
    resolveHung = resolve;
  });
  notifyRequest = ({ payload, path: route }) => {
    if (
      route.endsWith("chat/completions") &&
      payload.messages.some(
        (item) =>
          item.role === "tool" && item.tool_call_id === "write-before-cancel",
      )
    )
      resolveHung();
  };
  const running = service.run({ prompt: "创建文档", allowWrite: true });
  await hungRequest;
  assert.equal(service.isRunning(), true);
  await expectCode(service.saveSettings({ model: "other" }), "BUSY");
  service.cancel();
  await assert.rejects(
    running,
    (error) =>
      error.code === "CANCELLED" &&
      error.toolResults[0].name === "create_document",
  );
  assert.ok(
    (await repository.list()).documents.some(
      (doc) => doc.title === "取消前已写入",
    ),
  );
  notifyRequest = null;
  scripted = [];
  await service.saveSettings({ baseUrl: "https://example.invalid/v1" });
  assert.equal(
    service.getSettings().hasKey,
    false,
    "changing endpoint clears old key",
  );
  assert.ok(!JSON.stringify(service.guide()).includes(secret));

  // The cancellation deadline must not rely on fetch cooperatively aborting.
  const nonCooperative = await createAIService({
    repository,
    encrypt,
    decrypt,
    fetchImpl: async () => new Promise(() => {}),
  });
  await nonCooperative.init();
  const external = new AbortController();
  const never = nonCooperative.run({
    prompt: "取消无响应的提供商",
    signal: external.signal,
  });
  setTimeout(() => external.abort(), 20);
  await expectCode(never, "CANCELLED");
  await nonCooperative.close();
  console.log(
    "AI backend checks passed: offline CRUD, permissions, drafts, revisions, category independence, encrypted configuration, tool calls, source references, pure generation, incremental embeddings, redirect isolation and cancellation with committed-operation logs.",
  );
} finally {
  await service?.close();
  await reloaded?.close();
  repository.close();
  for (const socket of pendingSockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  // Only the explicitly created disposable test directory is removed.
  if (root.startsWith(path.join(os.tmpdir(), "rhine-ai-check-")))
    await fs.rm(root, { recursive: true, force: true });
}
