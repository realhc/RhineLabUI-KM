import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const fail = (code, message) => Object.assign(new Error(message), { code });
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const MAX_BODY = 1024 * 1024;
const messages = {
  AUTH: "需要有效的本机 API Bearer Token。",
  ORIGIN: "不接受浏览器跨来源请求。",
  HOST: "仅接受配置的 127.0.0.1 地址。",
  INPUT: "请求参数或 JSON 格式无效。",
  SIZE: "请求正文超过 1 MB。",
  TIMEOUT: "请求超时。",
  NOT_FOUND: "找不到此 API 或工具。",
  READ_ONLY: "本机 API 写入权限未开启。",
  BUSY: "AI 正在处理另一项请求，请稍后重试。",
  WRITE_DISABLED: "本机 API 写入权限未开启。",
  TOOL_NOT_FOUND: "找不到此知识库工具。",
  DIRTY: "知识库有未保存草稿，请先保存或取消编辑。",
  CONFLICT: "文档已变更，请重新读取修订后重试。",
  CLOSED: "本机 API 已关闭。",
  DISABLED: "请先配置并启用模型 API。",
};

/** Loopback-only, opt-in API for external agents. Never serves files or HTML.
 * The random credential lives only in this process and native IPC status; neither
 * HTTP responses nor persisted config contain it. Enabling remote AI model access
 * is separate from enabling this local knowledge-base interface.
 */
export function createAIHTTP({
  service,
  automation,
  repository,
  onChanged = () => {},
  requestTimeoutMs = 120000,
}) {
  const file = path.join(repository.root, "ai", "http.json");
  let config = { enabled: false, allowWrite: false, port: 0 };
  let revision = null;
  let server = null;
  let token = randomBytes(32).toString("hex");
  let actualPort = null;
  let lastError = null;
  let closed = false;
  let initialized = false;
  let queue = Promise.resolve();
  const requests = new Set();
  const notify = () => {
    try {
      onChanged();
    } catch {
      /* Native notification is advisory. */
    }
  };
  const status = () => ({
    enabled: config.enabled,
    allowWrite: config.allowWrite,
    port: actualPort,
    requestedPort: config.port,
    endpoint: actualPort ? `http://127.0.0.1:${actualPort}/v1` : null,
    token: config.enabled && server ? token : null,
    running: Boolean(server?.listening),
    error: lastError,
  });
  const persist = async () => {
    const raw = JSON.stringify({ version: 1, ...config }, null, 2) + "\n";
    await repository.atomic(file, raw, revision);
    revision = digest(raw);
  };

  function respond(response, statusCode, value) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
    response.end(JSON.stringify(value));
  }
  function errorResponse(response, error) {
    const code = error?.code ?? "AI";
    const statusCode =
      {
        AUTH: 401,
        ORIGIN: 403,
        HOST: 403,
        READ_ONLY: 403,
        WRITE_DISABLED: 403,
        NOT_FOUND: 404,
        TOOL_NOT_FOUND: 404,
        INPUT: 400,
        SIZE: 413,
        TIMEOUT: 408,
        BUSY: 409,
        DIRTY: 409,
        CONFLICT: 409,
        CLOSED: 503,
      }[code] ?? 422;
    // Native model/fs errors may contain provider URLs, keys or machine paths.
    // External callers receive an allowlisted code/message, never error.message.
    const safeCode = /^[A-Z][A-Z0-9_]{0,35}$/.test(code) ? code : "AI";
    respond(response, statusCode, {
      error: {
        code: safeCode,
        message:
          messages[code] ??
          "操作失败，请在客户端检查 AI 配置、任务或文档状态。",
      },
    });
  }
  function authenticated(request) {
    const value = request.headers.authorization;
    if (typeof value !== "string" || !/^Bearer [a-f0-9]{64}$/.test(value))
      return false;
    const candidate = Buffer.from(value.slice(7), "ascii");
    return timingSafeEqual(candidate, Buffer.from(token, "ascii"));
  }
  function readBody(request, signal) {
    return new Promise((resolve, reject) => {
      if (
        !(request.headers["content-type"] ?? "")
          .toLowerCase()
          .startsWith("application/json")
      ) {
        request.resume();
        reject(fail("INPUT", "JSON required"));
        return;
      }
      const length = Number(request.headers["content-length"] ?? 0);
      if (!Number.isFinite(length) || length > MAX_BODY) {
        request.resume();
        reject(fail("SIZE", "body too large"));
        return;
      }
      let size = 0;
      const chunks = [];
      const abort = () => {
        cleanup();
        request.resume();
        reject(fail("TIMEOUT", "request stopped"));
      };
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        request.removeListener("data", data);
        request.removeListener("end", end);
        request.removeListener("error", error);
      };
      const error = () => {
        cleanup();
        reject(fail("INPUT", "invalid body"));
      };
      const data = (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          cleanup();
          request.resume();
          reject(fail("SIZE", "body too large"));
        } else chunks.push(chunk);
      };
      const end = () => {
        cleanup();
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
          resolve(parsed);
        } catch {
          reject(fail("INPUT", "invalid JSON"));
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      request.on("data", data);
      request.on("end", end);
      request.on("error", error);
      if (signal.aborted) abort();
    });
  }

  async function handle(request, response) {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => {
      controller.abort();
      errorResponse(response, fail("TIMEOUT", "request timeout"));
    }, requestTimeoutMs);
    timeout.unref?.();
    const disconnected = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on("close", disconnected);
    try {
      if (closed || !config.enabled) throw fail("CLOSED", "closed");
      if (
        request.headers.origin !== undefined ||
        request.headers["sec-fetch-site"] !== undefined
      )
        throw fail("ORIGIN", "origin rejected");
      if (request.headers.host !== `127.0.0.1:${actualPort}`)
        throw fail("HOST", "invalid host");
      if (!authenticated(request)) throw fail("AUTH", "invalid token");
      if (requests.size > 8) throw fail("BUSY", "too many requests");
      const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
      if (url.search || url.hash) throw fail("INPUT", "query not supported");
      if (request.method === "GET" && url.pathname === "/v1/guide") {
        respond(response, 200, {
          ...(await service.guide()),
          localAPI: {
            allowWrite: config.allowWrite,
            scope: "本机知识库",
            automation: Boolean(automation),
            rules: [
              "先读取 guide 和 tools，按工具 JSON Schema 操作。",
              "写入与定时任务需要本机 API 写入开关。",
              "修改或删除前读取文档 revision；不要传文件路径。",
              "定时任务只在客户端运行期间执行，关闭后重开最多补跑一次。",
            ],
          },
        });
      } else if (request.method === "GET" && url.pathname === "/v1/tools") {
        respond(response, 200, {
          tools: await service.getTools(),
          allowWrite: config.allowWrite,
        });
      } else if (
        request.method === "POST" &&
        /^\/v1\/tools\/[a-zA-Z_]{1,80}$/.test(url.pathname)
      ) {
        const name = url.pathname.slice("/v1/tools/".length);
        const definitions = await service.getTools();
        if (!definitions.some((item) => item.function?.name === name))
          throw fail("NOT_FOUND", "unknown tool");
        const args = await readBody(request, controller.signal);
        const result = await service.executeTool(name, args, {
          allowWrite: config.allowWrite,
          signal: controller.signal,
          source: "http",
        });
        if (controller.signal.aborted) throw fail("TIMEOUT", "request stopped");
        respond(response, 200, { result });
      } else if (request.method === "POST" && url.pathname === "/v1/chat") {
        const args = await readBody(request, controller.signal);
        if (
          typeof args.prompt !== "string" ||
          !args.prompt.trim() ||
          args.prompt.length > 16000 ||
          (args.allowWrite !== undefined &&
            typeof args.allowWrite !== "boolean")
        )
          throw fail("INPUT", "invalid prompt");
        if (args.allowWrite === true && !config.allowWrite)
          throw fail("READ_ONLY", "writes disabled");
        const result = await service.run({
          prompt: args.prompt,
          documentId: args.documentId,
          documentIds: args.documentIds,
          allowWrite: config.allowWrite && args.allowWrite === true,
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw fail("TIMEOUT", "request stopped");
        respond(response, 200, result);
      } else throw fail("NOT_FOUND", "unknown endpoint");
    } catch (error) {
      errorResponse(response, error);
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
      response.removeListener("close", disconnected);
      request.resume();
    }
  }

  async function stop() {
    for (const controller of requests) controller.abort();
    if (!server) return;
    const previous = server;
    server = null;
    actualPort = null;
    await new Promise((resolve) => {
      previous.close(resolve);
      previous.closeAllConnections?.();
    });
  }
  async function start() {
    if (!config.enabled || closed) return;
    const created = http.createServer((request, response) => {
      void handle(request, response);
    });
    created.headersTimeout = 10000;
    created.requestTimeout = requestTimeoutMs;
    created.maxHeadersCount = 32;
    created.keepAliveTimeout = 1000;
    await new Promise((resolve, reject) => {
      const error = (cause) => {
        created.removeListener("listening", ready);
        reject(cause);
      };
      const ready = () => {
        created.removeListener("error", error);
        resolve();
      };
      created.once("error", error);
      created.once("listening", ready);
      created.listen({ host: "127.0.0.1", port: config.port, exclusive: true });
    });
    created.on("error", () => {
      lastError = "本机 API 监听发生错误，请在客户端重新启用。";
      notify();
    });
    server = created;
    actualPort = created.address().port;
    lastError = null;
  }
  return {
    async init() {
      if (closed) throw fail("CLOSED", "本机 API 已关闭。");
      if (initialized) return status();
      const folder = path.dirname(file);
      await repository.safe(folder, true);
      await fs.mkdir(folder, { recursive: true });
      await repository.safe(file, true);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 4096)
          throw fail("FORMAT", "本机 API 配置异常。");
        const raw = await fs.readFile(file, "utf8");
        const stored = JSON.parse(raw);
        if (
          stored.version !== 1 ||
          typeof stored.enabled !== "boolean" ||
          typeof stored.allowWrite !== "boolean" ||
          !Number.isInteger(stored.port) ||
          stored.port < 0 ||
          stored.port > 65535
        )
          throw fail("FORMAT", "本机 API 配置格式无效。");
        config = {
          enabled: stored.enabled,
          allowWrite: stored.allowWrite,
          port: stored.port,
        };
        revision = digest(raw);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await start();
      } catch {
        lastError = "本机 API 无法启动，检查端口是否占用后重新启用。";
      }
      initialized = true;
      return status();
    },
    status,
    configure(input) {
      const result = queue.then(async () => {
        if (closed) throw fail("CLOSED", "服务已关闭。");
        if (
          !input ||
          typeof input.enabled !== "boolean" ||
          typeof input.allowWrite !== "boolean" ||
          (input.rotateToken !== undefined &&
            typeof input.rotateToken !== "boolean") ||
          (input.port !== undefined &&
            (!Number.isInteger(input.port) ||
              input.port < 0 ||
              input.port > 65535))
        ) {
          throw fail("INPUT", "本机 API 配置无效。");
        }
        const next = {
          enabled: input.enabled,
          allowWrite: input.allowWrite,
          port: input.port ?? config.port,
        };
        const restart =
          config.enabled !== next.enabled ||
          config.port !== next.port ||
          (next.enabled && !server);
        // On permission/token changes terminate old in-flight requests before using
        // the new capability; a disabled interface must not leave an active agent.
        const permissionsChanged =
          config.allowWrite !== next.allowWrite || input.rotateToken === true;
        if (restart || permissionsChanged) await stop();
        config = next;
        if (input.rotateToken === true) token = randomBytes(32).toString("hex");
        await persist();
        if ((restart || permissionsChanged) && config.enabled) {
          try {
            await start();
          } catch {
            lastError = "本机 API 无法启动，检查端口是否占用后重新启用。";
            notify();
            throw fail("LISTEN", lastError);
          }
        }
        notify();
        return status();
      });
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      closed = true;
      await queue;
      await stop();
    },
  };
}
