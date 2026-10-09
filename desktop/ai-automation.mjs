import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = (value) => structuredClone(value);
const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const iso = (time) => new Date(time).toISOString();
const retryable = new Set([
  "BUSY",
  "DIRTY",
  "UNSAVED",
  "DRAFT",
  "CANCELLED",
  "ABORT_ERR",
]);
const errorMessages = {
  AI_DISABLED: "模型 AI 尚未启用，请先配置并启用后再运行任务。",
  AI_CONFIG: "模型接口地址或模型名称未配置，请检查 AI 设置。",
  AI_KEY: "模型密钥不可用，请重新填写 API Key。",
  AI_ENCRYPTION: "系统密钥加密不可用，请检查本机加密支持。",
  AI_AUTH: "模型服务拒绝认证，请检查 API Key 与模型权限。",
  AI_HTTP: "模型服务返回请求错误，请检查提供商状态、额度与模型名称。",
  AI_REQUEST: "模型连接失败，请检查服务地址与网络后重试。",
  AI_TIMEOUT: "模型请求超时，请检查服务后重试。",
  AI_FORMAT: "模型返回格式不兼容，请检查是否支持 Chat Completions。",
  AI_LIMIT: "模型返回内容或工具调用超过限制，请缩小任务范围。",
  MODEL_OUTPUT: "模型没有返回可保存的正文，请调整指引后重试。",
  NOT_FOUND: "任务引用的文档或目标分类已移除，请更新任务配置。",
  INPUT: "任务参数无效，请检查指引、时间与参考文档。",
  WRITE_DISABLED: "任务写入未获得许可，请检查 AI 写入设置。",
  DUPLICATE_TITLE: "生成文档标题已存在，请检查现有文档后重试。",
  CONFLICT: "知识库或任务文件已被外部修改，请重新载入后重试。",
  WRITE: "新文档或任务状态无法写入，请检查目录写入权限后重试。",
  EACCES: "知识库目录没有写入权限，请检查文件夹权限后重试。",
  EPERM: "系统阻止写入知识库，请检查权限及文件占用后重试。",
  ENOSPC: "存储空间不足，请释放空间后重试。",
};

function scheduleInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("INPUT", "请选择有效的任务时间。");
  if (
    input.type === "once" &&
    typeof input.at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input.at,
    ) &&
    Number.isFinite(Date.parse(input.at))
  ) {
    return { type: "once", at: iso(Date.parse(input.at)) };
  }
  if (
    input.type === "daily" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time ?? "")
  ) {
    return { type: "daily", time: input.time };
  }
  if (
    input.type === "interval" &&
    Number.isInteger(input.minutes) &&
    input.minutes >= 5 &&
    input.minutes <= 525600
  ) {
    return { type: "interval", minutes: input.minutes };
  }
  throw fail(
    "INPUT",
    "任务时间应为单次 ISO 日期、每天 HH:mm 或至少 5 分钟间隔。",
  );
}

function nextTime(schedule, after) {
  if (schedule.type === "once") return schedule.at;
  if (schedule.type === "interval")
    return iso(after + schedule.minutes * 60000);
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const date = new Date(after);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= after) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function tool(
  name,
  description,
  properties,
  required = [],
  execute,
  mutates = true,
) {
  return {
    mutates,
    definition: {
      type: "function",
      function: {
        name,
        description,
        parameters: {
          type: "object",
          properties,
          required,
          additionalProperties: false,
        },
      },
    },
    execute,
  };
}

/**
 * Optional background service; it never owns document files or evaluates model code.
 * All document changes pass through the same AI tools/repository as native edits.
 * A durable generated-result journal closes the create/ack crash window: recovery
 * finds the exact title and body, including trash, before attempting another create.
 */
export function createAIAutomation({
  repository,
  service,
  onChanged = () => {},
  now = Date.now,
  pollMs = 30000,
}) {
  const file = path.join(repository.root, "ai", "tasks.json");
  let state = { version: 1, tasks: [] };
  let committedState = clone(state);
  let revision = null;
  let queue = Promise.resolve();
  let timer;
  let closed = false;
  let active = null;
  let checking = false;
  let initialized = false;

  const exclusive = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const notify = () => {
    try {
      onChanged();
    } catch {
      /* UI notification must not undo persisted work. */
    }
  };
  const persist = async () => {
    const raw = JSON.stringify(state, null, 2) + "\n";
    try {
      await repository.atomic(file, raw, revision);
    } catch (error) {
      state = clone(committedState);
      throw error;
    }
    revision = digest(raw);
    committedState = clone(state);
    notify();
  };
  const member = (id) => {
    const item = state.tasks.find((task) => task.id === id);
    if (!item) throw fail("NOT_FOUND", "找不到此定时任务。");
    return item;
  };
  const publicTask = (item) => {
    const { pending, ...task } = clone(item);
    return {
      ...task,
      status:
        active === item.id && item.status === "running"
          ? "running"
          : ["failed", "paused", "cancelled"].includes(item.status)
            ? item.status
            : pending
              ? "queued"
              : item.status,
    };
  };
  const appendLog = (task, status, message, documentId) => {
    task.logs = [
      ...(task.logs ?? []),
      {
        at: iso(now()),
        status,
        message,
        ...(documentId ? { documentId } : {}),
      },
    ].slice(-30);
  };

  async function validateTask(input, previous) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw fail("INPUT", "任务参数无效。");
    const merged = { ...previous, ...input };
    if (
      typeof merged.title !== "string" ||
      !merged.title.trim() ||
      merged.title.length > 200 ||
      typeof merged.prompt !== "string" ||
      !merged.prompt.trim() ||
      merged.prompt.length > 16000 ||
      typeof merged.enabled !== "boolean"
    )
      throw fail("INPUT", "请填写任务名称、指引和启用状态。");
    const categoryId = merged.categoryId ?? null;
    const documentIds = merged.documentIds ?? [];
    if (categoryId !== null && !validId(categoryId))
      throw fail("INPUT", "分类 ID 无效。");
    if (
      !Array.isArray(documentIds) ||
      documentIds.length > 8 ||
      documentIds.some((id) => !validId(id))
    ) {
      throw fail("INPUT", "任务最多引用 8 篇文档的稳定 ID。");
    }
    const listing = await repository.list();
    if (
      categoryId !== null &&
      !listing.categories.some((category) => category.id === categoryId)
    )
      throw fail("NOT_FOUND", "任务分类已移除。");
    for (const id of documentIds)
      if (!listing.documents.some((document) => document.id === id))
        throw fail("NOT_FOUND", "任务引用的文档已移除。");
    return {
      title: merged.title.trim(),
      prompt: merged.prompt.trim(),
      enabled: merged.enabled,
      schedule: scheduleInput(merged.schedule),
      categoryId,
      documentIds: [...new Set(documentIds)],
    };
  }

  async function runTask(id, manual = false) {
    if (closed) throw fail("CLOSED", "自动化服务已关闭。");
    if (active) throw fail("BUSY", "另一项 AI 任务正在运行，请稍后重试。");
    active = id;
    let snapshot;
    try {
      snapshot = await exclusive(async () => {
        const task = member(id);
        if (!task.pending) {
          const runId = randomUUID();
          task.pending = {
            id: runId,
            due: task.requestedAt ?? task.nextRun ?? iso(now()),
            phase: "generating",
            manual: manual || Boolean(task.requestedAt),
            title: `${task.title} · ${iso(now()).replace("T", " ").slice(0, 16)} · ${runId.slice(0, 8)}`,
          };
          delete task.requestedAt;
        }
        task.status = "running";
        await persist();
        return clone(task);
      });
      if (snapshot.pending.phase !== "generated") {
        // tools:false prevents generated instructions from reading outside explicit
        // scope or creating additional documents. This task creates exactly one.
        const result = await service.run({
          prompt: `${snapshot.prompt}\n\n请直接返回可保存的 Markdown 文档正文。只使用明确提供的参考文档；不要调用写入工具或安排其他任务。`,
          documentIds: snapshot.documentIds,
          allowWrite: false,
          tools: false,
        });
        if (
          !result ||
          typeof result.text !== "string" ||
          !result.text.trim() ||
          Buffer.byteLength(result.text) > 15 * 1024 * 1024
        ) {
          throw fail("MODEL_OUTPUT", "模型没有返回可保存的文档正文。");
        }
        await exclusive(async () => {
          const task = member(id);
          task.pending.body = result.text;
          task.pending.phase = "generated";
          await persist();
          snapshot = clone(task);
        });
      }
      if (closed)
        throw fail("CANCELLED", "任务在程序关闭时暂停，下次启动继续恢复。");
      const listing = await repository.list();
      const existing = [...listing.documents, ...listing.trash].find(
        (document) =>
          document.title === snapshot.pending.title &&
          document.body === snapshot.pending.body,
      );
      let document = existing;
      if (!document) {
        document = await service.executeTool(
          "create_document",
          {
            title: snapshot.pending.title,
            body: snapshot.pending.body,
            categoryId: snapshot.categoryId,
          },
          { allowWrite: true, source: "automation" },
        );
        // Service tools may wrap their document result; accept both established shapes.
        document = document?.document ?? document;
        if (!validId(document?.id))
          throw fail("WRITE", "任务文档创建结果无效。");
      }
      return await exclusive(async () => {
        const task = member(id);
        task.lastRun = iso(now());
        task.lastDocId = document.id;
        task.status = "completed";
        task.lastError = null;
        task.nextRun =
          task.schedule.type === "once" ? null : nextTime(task.schedule, now());
        if (task.schedule.type === "once") task.enabled = false;
        appendLog(
          task,
          "completed",
          existing ? "已恢复上次生成的文档，未重复创建。" : "已生成新文档。",
          document.id,
        );
        delete task.pending;
        await persist();
        return publicTask(task);
      });
    } catch (error) {
      await exclusive(async () => {
        const task = state.tasks.find((item) => item.id === id);
        if (!task) return;
        const explicitlyCancelled = error.code === "CANCELLED" && !closed;
        const deferred = retryable.has(error.code) && !explicitlyCancelled;
        task.status = deferred
          ? "queued"
          : explicitlyCancelled
            ? "cancelled"
            : "failed";
        task.lastError = {
          code: error.code ?? "AI",
          message: deferred
            ? "等待 AI 空闲或保存草稿后重试。"
            : explicitlyCancelled
              ? "任务已取消并暂停，可手动重试或重新启用。"
              : (errorMessages[error.code] ??
                "任务执行失败，请检查模型配置与任务日志后重试。"),
        };
        // Failures pause recurring jobs; a durable pending result remains available
        // for manual retry, avoiding repeated paid requests and duplicate output.
        if (!deferred) {
          task.enabled = false;
          if (task.pending) task.pending.manual = false;
        }
        appendLog(task, task.status, task.lastError.message);
        await persist();
      }).catch(() => {});
      throw error;
    } finally {
      active = null;
      notify();
    }
  }

  async function checkDue() {
    if (closed || checking || active) return;
    checking = true;
    try {
      // Each overdue task runs at most once: success advances from current time,
      // not from its old due time. Long sleep never generates a backlog of files.
      for (const task of clone(state.tasks).sort(
        (a, b) => Date.parse(a.nextRun ?? 0) - Date.parse(b.nextRun ?? 0),
      )) {
        if (closed) break;
        const due =
          task.requestedAt ||
          task.pending?.manual ||
          (task.enabled &&
            (task.pending ||
              (task.nextRun && Date.parse(task.nextRun) <= now())));
        if (!due) continue;
        try {
          await runTask(task.id);
        } catch (error) {
          if (retryable.has(error.code) && error.code !== "CANCELLED") break;
        }
      }
    } finally {
      checking = false;
    }
  }

  const api = {
    async init() {
      if (closed) throw fail("CLOSED", "自动化服务已关闭。");
      if (initialized) return api.list();
      const folder = path.dirname(file);
      await repository.safe(folder, true);
      await fs.mkdir(folder, { recursive: true });
      await repository.safe(file, true);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
          throw fail("FORMAT", "自动化任务文件异常。");
        const raw = await fs.readFile(file, "utf8");
        const stored = JSON.parse(raw);
        if (
          stored.version !== 1 ||
          !Array.isArray(stored.tasks) ||
          stored.tasks.length > 100
        )
          throw fail("FORMAT", "自动化任务文件格式无效。");
        const ids = new Set();
        for (const task of stored.tasks) {
          if (!validId(task.id) || ids.has(task.id))
            throw fail("FORMAT", "自动化任务 ID 无效或重复。");
          ids.add(task.id);
          scheduleInput(task.schedule);
          if (
            typeof task.title !== "string" ||
            typeof task.prompt !== "string" ||
            typeof task.enabled !== "boolean" ||
            !Array.isArray(task.documentIds) ||
            task.documentIds.length > 8 ||
            task.documentIds.some((id) => !validId(id)) ||
            (task.categoryId !== null && !validId(task.categoryId)) ||
            (task.nextRun !== null &&
              !Number.isFinite(Date.parse(task.nextRun))) ||
            (task.pending &&
              (!validId(task.pending.id) ||
                typeof task.pending.title !== "string" ||
                !["generating", "generated"].includes(task.pending.phase) ||
                (task.pending.phase === "generated" &&
                  typeof task.pending.body !== "string")))
          ) {
            throw fail("FORMAT", "自动化任务内容格式无效。");
          }
          if (task.status === "running") task.status = "queued";
        }
        state = stored;
        committedState = clone(state);
        revision = digest(raw);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      registerTools();
      initialized = true;
      timer = setInterval(
        () => {
          void checkDue();
        },
        Math.max(1000, pollMs),
      );
      timer.unref?.();
      // Start after native initialization, with errors isolated from offline features.
      setImmediate(() => {
        void checkDue();
      });
      return api.list();
    },
    list() {
      return state.tasks.map(publicTask);
    },
    async save(input) {
      return exclusive(async () => {
        if (closed) throw fail("CLOSED", "自动化服务已关闭。");
        if (input?.id && !validId(input.id))
          throw fail("INPUT", "任务 ID 无效。");
        const existing = input?.id ? member(input.id) : null;
        if (existing && active === existing.id)
          throw fail("BUSY", "请等待任务完成后再修改。");
        if (!existing && state.tasks.length >= 100)
          throw fail("LIMIT", "最多保留 100 项定时任务。");
        const data = await validateTask(input, existing);
        const scheduleChanged =
          !existing ||
          JSON.stringify(data.schedule) !== JSON.stringify(existing.schedule);
        const task = existing ?? {
          id: randomUUID(),
          created: iso(now()),
          logs: [],
          lastRun: null,
          lastDocId: null,
        };
        Object.assign(task, data, { updated: iso(now()), lastError: null });
        if (scheduleChanged || (!task.nextRun && task.enabled))
          task.nextRun = nextTime(data.schedule, now());
        // Editing instructions explicitly discards an unfinished generated draft.
        if (
          existing &&
          (input.prompt !== undefined ||
            input.documentIds !== undefined ||
            input.categoryId !== undefined)
        )
          delete task.pending;
        if (input.enabled === false) {
          delete task.requestedAt;
          if (task.pending) task.pending.manual = false;
        }
        task.status = task.enabled ? "scheduled" : "paused";
        if (!existing) state.tasks.push(task);
        await persist();
        return publicTask(task);
      });
    },
    async remove(id) {
      return exclusive(async () => {
        if (active === id) throw fail("BUSY", "请等待任务完成后再移除。");
        member(id);
        state.tasks = state.tasks.filter((task) => task.id !== id);
        await persist();
        return { id, removed: true };
      });
    },
    runNow(id) {
      return runTask(id, true);
    },
    checkDue,
    async close() {
      closed = true;
      clearInterval(timer);
      await queue;
    },
  };

  function registerTools() {
    const id = { type: "string", description: "定时任务稳定 ID" };
    const props = {
      title: { type: "string", maxLength: 200 },
      prompt: { type: "string", maxLength: 16000 },
      enabled: { type: "boolean" },
      categoryId: {
        anyOf: [{ type: "string", maxLength: 96 }, { type: "null" }],
      },
      documentIds: { type: "array", items: { type: "string" }, maxItems: 8 },
      schedule: {
        type: "object",
        description:
          "{type:once,at:ISO} 或 {type:daily,time:HH:mm} 或 {type:interval,minutes:至少5}",
      },
    };
    service.registerTools([
      tool(
        "list_tasks",
        "查看本机定时文档任务、下次运行、结果和日志。程序关闭时不执行。",
        {},
        [],
        () => api.list(),
        false,
      ),
      tool(
        "create_task",
        "建立生成新文档的任务。需用户明确要求，模型不覆盖已有文档。",
        props,
        ["title", "prompt", "enabled", "schedule"],
        (args) => api.save(args),
      ),
      tool(
        "update_task",
        "修改既有定时文档任务；提供需要修改的字段。",
        { id, ...props },
        ["id"],
        (args) => api.save(args),
      ),
      tool(
        "delete_task",
        "移除定时任务，保留任务已经创建的文档。",
        { id },
        ["id"],
        (args) => api.remove(args.id),
      ),
      tool(
        "run_task",
        "请求尽快执行定时任务，返回排队状态；之后用 list_tasks 检查结果。",
        { id },
        ["id"],
        async (args) => {
          await exclusive(async () => {
            const task = member(args.id);
            if (active === task.id) throw fail("BUSY", "任务已经在运行。");
            task.requestedAt = iso(now());
            task.status = "queued";
            await persist();
          });
          setImmediate(() => {
            void checkDue();
          });
          return {
            id: args.id,
            status: "queued",
            message: "程序运行期间在 AI 空闲后执行，请用 list_tasks 查看结果。",
          };
        },
      ),
    ]);
  }
  return api;
}
