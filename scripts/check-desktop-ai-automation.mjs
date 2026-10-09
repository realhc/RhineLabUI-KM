import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Repository } from "../desktop/repository.mjs";
import { createAIAutomation } from "../desktop/ai-automation.mjs";
import { createAIHTTP } from "../desktop/ai-http.mjs";
import { createAIService } from "../desktop/ai-service.mjs";

// Only ephemeral data and deterministic model output; never touches a portable
// client's personal files or sends document text to a remote provider.
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "rhine-ai-automation-"),
);
const repository = new Repository(path.join(temporary, "RhineLabData"));
let clock = new Date("2026-10-09T10:00:00+08:00").getTime();
let automation;
let api;
let realService;
let generationCount = 0;
let modelFailure = null;
let blockGeneration = null;
const definitions = new Map();
const service = {
  registerTools(items) {
    for (const item of items)
      definitions.set(item.definition.function.name, item);
  },
  getTools() {
    return [...definitions.values()].map((item) => item.definition);
  },
  guide() {
    return { version: 1, rules: ["use stable ids"], tools: this.getTools() };
  },
  async run(input) {
    if (modelFailure)
      throw Object.assign(new Error("secret-provider-token-machine-path"), {
        code: modelFailure,
      });
    generationCount++;
    if (blockGeneration) await blockGeneration;
    assert.equal(input.allowWrite, false);
    assert.equal(input.tools, false);
    return {
      text: `# 自动生成\n\n这是第 ${generationCount} 次生成。`,
      references: [],
      toolResults: [],
    };
  },
  async executeTool(name, args, context = {}) {
    const item = definitions.get(name);
    if (!item) throw Object.assign(new Error("unknown"), { code: "NOT_FOUND" });
    if (item.mutates && !context.allowWrite)
      throw Object.assign(new Error("disabled"), { code: "READ_ONLY" });
    if (context.signal?.aborted)
      throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
    return item.execute(args, context);
  },
};
service.registerTools([
  {
    mutates: false,
    definition: {
      type: "function",
      function: { name: "list_documents", parameters: { type: "object" } },
    },
    execute: () => repository.list(),
  },
  {
    mutates: true,
    definition: {
      type: "function",
      function: { name: "create_document", parameters: { type: "object" } },
    },
    execute: async (args) => {
      const listing = await repository.list();
      const category =
        listing.categories.find((item) => item.id === args.categoryId)?.name ??
        "未分类";
      return repository.create({ ...args, category });
    },
  },
  {
    mutates: false,
    definition: {
      type: "function",
      function: { name: "fail_safe", parameters: { type: "object" } },
    },
    execute: () => {
      throw new Error("secret-token C:/personal/example");
    },
  },
  {
    mutates: false,
    definition: {
      type: "function",
      function: { name: "wait_tool", parameters: { type: "object" } },
    },
    execute: (_args, context) =>
      new Promise((_resolve, reject) => {
        const abort = () =>
          reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
        if (context.signal.aborted) abort();
        else context.signal.addEventListener("abort", abort, { once: true });
      }),
  },
]);
const request = ({
  port,
  method = "GET",
  route = "/v1/guide",
  token,
  headers = {},
  body,
}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined)
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });

try {
  await repository.init();
  automation = createAIAutomation({ repository, service, now: () => clock });
  await automation.init();
  assert.deepEqual(automation.list(), []);
  assert.ok(definitions.has("create_task") && definitions.has("run_task"));
  await assert.rejects(
    automation.save({
      title: "bad",
      prompt: "write",
      enabled: true,
      schedule: { type: "interval", minutes: 4 },
    }),
    { code: "INPUT" },
  );
  await assert.rejects(
    automation.save({
      title: "bad",
      prompt: "write",
      enabled: true,
      schedule: { type: "daily", time: "25:10" },
    }),
    { code: "INPUT" },
  );
  const hourly = await automation.save({
    title: "小时总结",
    prompt: "写一段总结",
    enabled: true,
    schedule: { type: "interval", minutes: 60 },
  });
  await automation.checkDue();
  assert.equal(generationCount, 0);
  clock += 5 * 3600000;
  await automation.checkDue();
  assert.equal(
    generationCount,
    1,
    "sleep catch-up executes once, not five times",
  );
  await automation.checkDue();
  assert.equal(generationCount, 1);
  assert.equal(Date.parse(automation.list()[0].nextRun), clock + 3600000);
  const once = await automation.save({
    title: "一次任务",
    prompt: "写一段",
    enabled: true,
    schedule: { type: "once", at: new Date(clock - 1000).toISOString() },
  });
  await automation.checkDue();
  assert.equal(
    automation.list().find((task) => task.id === once.id).enabled,
    false,
  );
  assert.equal(
    automation.list().find((task) => task.id === once.id).nextRun,
    null,
  );
  await automation.checkDue();
  assert.equal(generationCount, 2);

  // A busy model is deferred; it does not disable an explicitly requested task.
  const manual = await automation.save({
    title: "手动任务",
    prompt: "写一段",
    enabled: false,
    schedule: { type: "interval", minutes: 5 },
  });
  modelFailure = "BUSY";
  await assert.rejects(automation.runNow(manual.id), { code: "BUSY" });
  modelFailure = null;
  await automation.checkDue();
  assert.ok(automation.list().find((task) => task.id === manual.id).lastDocId);
  assert.equal(
    automation.list().find((task) => task.id === manual.id).enabled,
    false,
  );

  // Crash after the document write but before task acknowledgement: the durable
  // pending output finds that exact document on restart, without another model run.
  const crashTask = await automation.save({
    title: "恢复验证",
    prompt: "写一段",
    enabled: false,
    schedule: { type: "interval", minutes: 5 },
  });
  const atomic = repository.atomic.bind(repository);
  let injected = false;
  repository.atomic = async (target, content, expected) => {
    if (
      !injected &&
      target.endsWith("tasks.json") &&
      JSON.parse(content).tasks.some(
        (task) => task.id === crashTask.id && task.status === "completed",
      )
    ) {
      injected = true;
      throw Object.assign(new Error("simulated crash"), { code: "WRITE" });
    }
    return atomic(target, content, expected);
  };
  await assert.rejects(automation.runNow(crashTask.id), { code: "WRITE" });
  const beforeRecovery = (await repository.list()).documents.length;
  const generationsBeforeRecovery = generationCount;
  repository.atomic = atomic;
  await automation.close();
  automation = createAIAutomation({ repository, service, now: () => clock });
  await automation.init();
  await automation.runNow(crashTask.id);
  assert.equal(
    (await repository.list()).documents.length,
    beforeRecovery,
    "recovered create cannot duplicate",
  );
  assert.equal(
    generationCount,
    generationsBeforeRecovery,
    "recovered output does not call model again",
  );

  const failureTask = await automation.save({
    title: "失败验证",
    prompt: "写一段",
    enabled: true,
    schedule: { type: "once", at: new Date(clock - 1).toISOString() },
  });
  modelFailure = "HTTP";
  await automation.checkDue();
  const failed = automation.list().find((task) => task.id === failureTask.id);
  assert.equal(failed.status, "failed");
  assert.equal(
    failed.enabled,
    false,
    "permanent failure pauses task to avoid repeated paid retries",
  );
  assert.ok(!JSON.stringify(failed).includes("secret-provider-token"));
  modelFailure = null;
  let release;
  blockGeneration = new Promise((resolve) => {
    release = resolve;
  });
  const running = automation.runNow(manual.id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(automation.runNow(hourly.id), { code: "BUSY" });
  await assert.rejects(automation.remove(manual.id), { code: "BUSY" });
  release();
  await running;
  blockGeneration = null;

  const cancellationTask = await automation.save({
    title: "取消验证",
    prompt: "写一段",
    enabled: true,
    schedule: { type: "interval", minutes: 5 },
  });
  modelFailure = "CANCELLED";
  await assert.rejects(automation.runNow(cancellationTask.id), {
    code: "CANCELLED",
  });
  const cancelled = automation
    .list()
    .find((task) => task.id === cancellationTask.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.enabled, false);
  modelFailure = null;
  const callsAfterCancel = generationCount;
  await automation.checkDue();
  assert.equal(
    generationCount,
    callsAfterCancel,
    "explicit cancellation cannot restart itself",
  );

  const closingTask = await automation.save({
    title: "退出恢复",
    prompt: "写一段",
    enabled: false,
    schedule: { type: "interval", minutes: 5 },
  });
  blockGeneration = new Promise((resolve) => {
    release = resolve;
  });
  const interrupted = automation.runNow(closingTask.id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await automation.close();
  release();
  await assert.rejects(interrupted, { code: "CANCELLED" });
  assert.equal(
    automation.list().find((task) => task.id === closingTask.id).status,
    "queued",
  );
  blockGeneration = null;
  const callsBeforeReopen = generationCount;
  automation = createAIAutomation({ repository, service, now: () => clock });
  await automation.init();
  await automation.checkDue();
  assert.ok(
    automation.list().find((task) => task.id === closingTask.id).lastDocId,
  );
  assert.equal(
    generationCount,
    callsBeforeReopen,
    "closing preserves a completed generation for recovery",
  );

  const unavailableTask = await automation.save({
    title: "未接模型",
    prompt: "写一段",
    enabled: false,
    schedule: { type: "interval", minutes: 5 },
  });
  modelFailure = "AI_DISABLED";
  await assert.rejects(automation.runNow(unavailableTask.id), {
    code: "AI_DISABLED",
  });
  assert.match(
    automation.list().find((task) => task.id === unavailableTask.id).lastError
      .message,
    /尚未启用/,
  );
  modelFailure = null;

  api = createAIHTTP({
    repository,
    service,
    automation,
    requestTimeoutMs: 200,
  });
  await api.init();
  assert.equal(api.status().running, false, "local API is opt-in");
  let connection = await api.configure({ enabled: true, allowWrite: false });
  assert.equal(connection.running, true);
  assert.equal(connection.token.length, 64);
  const guide = await request(connection);
  assert.equal(guide.status, 200);
  assert.ok(!guide.text.includes(connection.token));
  assert.equal(guide.headers["access-control-allow-origin"], undefined);
  assert.equal(
    (await request({ ...connection, token: undefined })).status,
    401,
  );
  assert.equal(
    (
      await request({
        ...connection,
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request({ ...connection, headers: { Host: "evil.example" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/create_document",
        body: { title: "拒绝", body: "x", categoryId: null },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/list_documents",
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/list_documents",
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/list_documents",
        body: "x".repeat(1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  assert.equal(
    (await request({ ...connection, route: "/v1/unknown" })).status,
    404,
  );
  const safe = await request({
    ...connection,
    method: "POST",
    route: "/v1/tools/fail_safe",
    body: {},
  });
  assert.equal(safe.status, 422);
  assert.ok(
    !safe.text.includes("secret-token") && !safe.text.includes("personal"),
  );
  const timedOut = await request({
    ...connection,
    method: "POST",
    route: "/v1/tools/wait_tool",
    body: {},
  });
  assert.equal(
    timedOut.status,
    408,
    "request timeout aborts the underlying operation",
  );
  const oldToken = connection.token;
  connection = await api.configure({
    enabled: true,
    allowWrite: true,
    rotateToken: true,
  });
  assert.notEqual(connection.token, oldToken);
  assert.equal((await request({ ...connection, token: oldToken })).status, 401);
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/create_document",
        body: { title: "外部 AI 新文档", body: "# 本机接口", categoryId: null },
      })
    ).status,
    200,
  );
  const configText = await fs.readFile(
    path.join(repository.root, "ai", "http.json"),
    "utf8",
  );
  assert.ok(!configText.includes(connection.token));
  await api.close();
  api = null;
  await assert.rejects(
    request(connection),
    (error) => error.code === "ECONNREFUSED" || error.code === "ECONNRESET",
  );
  const restartedAPI = createAIHTTP({ repository, service, automation });
  api = restartedAPI;
  await api.init();
  assert.equal(api.status().running, true);
  assert.notEqual(
    api.status().token,
    connection.token,
    "credential rotates on process restart",
  );
  await api.configure({ enabled: false, allowWrite: false });
  assert.equal(api.status().running, false);
  assert.equal(api.status().token, null);
  await api.close();
  await automation.close();

  // Contract test against the actual service: nullable category schema, tool
  // permissions, generated-only requests and shared dirty protection must match.
  let dirty = false;
  let realModelCalls = 0;
  realService = await createAIService({
    repository,
    isDirty: () => dirty,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      realModelCalls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: `# 真实核心契约\n\n模型调用 ${realModelCalls}`,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });
  await realService.init();
  await realService.saveSettings({
    enabled: true,
    baseUrl: "http://127.0.0.1:12345/v1",
    model: "test-model",
  });
  automation = createAIAutomation({
    repository,
    service: realService,
    now: () => clock,
  });
  await automation.init();
  api = createAIHTTP({ repository, service: realService, automation });
  await api.init();
  connection = await api.configure({ enabled: true, allowWrite: false });
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/tools/create_task",
        body: {
          title: "真实接口",
          prompt: "写总结",
          enabled: false,
          categoryId: null,
          documentIds: [],
          schedule: { type: "interval", minutes: 5 },
        },
      })
    ).status,
    403,
  );
  connection = await api.configure({ enabled: true, allowWrite: true });
  const createdResponse = await request({
    ...connection,
    method: "POST",
    route: "/v1/tools/create_task",
    body: {
      title: "真实接口",
      prompt: "写总结",
      enabled: false,
      categoryId: null,
      documentIds: [],
      schedule: { type: "interval", minutes: 5 },
    },
  });
  assert.equal(createdResponse.status, 200);
  const realTask = JSON.parse(createdResponse.text).result;
  dirty = true;
  await assert.rejects(automation.runNow(realTask.id), { code: "DIRTY" });
  const pendingModelCalls = realModelCalls;
  dirty = false;
  await automation.checkDue();
  assert.equal(
    realModelCalls,
    pendingModelCalls,
    "dirty retry reuses saved generation",
  );
  assert.ok(
    automation.list().find((task) => task.id === realTask.id).lastDocId,
  );
  assert.equal(
    (
      await request({
        ...connection,
        method: "POST",
        route: "/v1/chat",
        body: { prompt: "总结知识库", allowWrite: false },
      })
    ).status,
    200,
  );
  console.log(
    "AI automation/API checks passed: catch-up, manual retry, crash deduplication, failure/cancel pause, close recovery, concurrency, loopback/auth/origin, read-only, body limit/timeout, safe errors, token rotation, shutdown and real-service contract/dirty recovery.",
  );
} finally {
  await api?.close();
  await automation?.close();
  await realService?.close();
  repository.close();
  const resolved = path.resolve(temporary);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(resolved, { recursive: true, force: true });
}
