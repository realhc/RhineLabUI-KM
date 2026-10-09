import MarkdownIt from "markdown-it";
import "./desktop-ai.css";

/** Loaded only when requested; UI depends on the optional bridge, never on a model SDK. */
export function mountAIWorkspace(
  overlay: HTMLElement,
  hooks: {
    selected: () => RhineDocument | undefined;
    categories: () => RhineCategory[];
    beforeWrite: () => Promise<boolean>;
    navigate: (id: string) => Promise<void>;
    changed: () => Promise<void>;
  },
) {
  const api = window.rhineAI;
  const panel = document.createElement("dialog");
  panel.id = "ai-workspace";
  panel.setAttribute("aria-label", "AI 与自动化");
  panel.innerHTML = `<div class="ai-heading"><div><span class="eyebrow">ARCHIVE INTELLIGENCE</span><h2>AI 与自动化</h2></div><button id="ai-close" aria-label="关闭 AI 与自动化">CLOSE ×</button></div>
    <nav class="ai-tabs" aria-label="AI 功能"><button data-ai-tab="chat" class="active">知识库助手</button><button data-ai-tab="tasks">定时文档</button><button data-ai-tab="connect">接入设置</button><button data-ai-tab="guide">AI 指引</button></nav>
    <p id="ai-status" role="status" aria-live="polite"></p>
    <section data-ai-page="chat"><p class="ai-muted">查询、总结和整理本地知识库。只有启用本次写入，助手才可增改文档或移入回收区。</p><div id="ai-answer" class="ai-answer" aria-label="AI 回答"></div><div id="ai-references" class="ai-references"></div><details id="ai-operations" hidden><summary>本次操作记录</summary><pre></pre></details><label>你的要求<textarea id="ai-prompt" rows="4" maxlength="16000" placeholder="例如：总结当前文档，并指出需要补充的内容。"></textarea></label><div class="ai-options"><label><input id="ai-current" type="checkbox" checked> 附带当前文档</label><label><input id="ai-write" type="checkbox"> 允许本次写入</label></div><div class="ai-actions"><button id="ai-send" class="solid">执行</button><button id="ai-stop" disabled>停止</button><button id="ai-summary">总结当前文档</button></div></section>
    <section data-ai-page="connect" hidden><p class="ai-muted">模型接口兼容 Chat Completions 与工具调用。远程模型会收到请求涉及的文档内容；本机模型可使用本地接口。不接入 AI 时原有功能照常使用。</p><form id="ai-settings"><label class="ai-check"><input id="ai-enabled" type="checkbox"> 启用模型连接</label><label>API Base URL<input id="ai-base" type="url" placeholder="https://服务商地址/v1" maxlength="2048"></label><div class="ai-columns"><label>对话模型<input id="ai-model" maxlength="200" placeholder="模型名称"></label><label>向量模型（可选）<input id="ai-embedding" maxlength="200" placeholder="用于语义搜索"></label></div><label>API Key<input id="ai-key" type="password" autocomplete="off" maxlength="4096" placeholder="留空保留已保存的密钥"></label><label class="ai-check"><input id="ai-clear-key" type="checkbox"> 清除已保存密钥</label><div class="ai-actions"><button class="solid" type="submit">保存接入</button><button id="ai-test" type="button">测试连接</button></div></form><hr><h3>本机知识库 API</h3><p class="ai-muted">供外部 AI 查阅指引并调用知识库工具。仅监听本机，独立于上方模型连接；令牌等同于所选访问权限，请保管好。</p><label class="ai-check"><input id="ai-http-enabled" type="checkbox"> 启用本机 API</label><label class="ai-check"><input id="ai-http-write" type="checkbox"> 允许 API 写入与任务管理</label><label>监听端口（0 自动选择）<input id="ai-http-port" type="number" min="0" max="65535" value="0"></label><div class="ai-actions"><button id="ai-http-save">应用 API 设置</button><button id="ai-http-rotate">更换令牌</button></div><div id="ai-http-info"></div></section>
    <section data-ai-page="tasks" hidden><p class="ai-muted">定时任务只创建新文档。程序运行时执行；关闭期间错过的任务重开后最多补跑一次。暂停任务可停止后续调度。</p><div id="ai-task-list"></div><form id="ai-task-form"><h3 id="ai-task-heading">新建定时文档</h3><label>任务名称<input id="ai-task-title" maxlength="160" required></label><label>编写要求<textarea id="ai-task-prompt" rows="3" maxlength="12000" required placeholder="例如：总结指定资料，生成本周学习回顾。"></textarea></label><div class="ai-columns"><label>执行方式<select id="ai-task-type"><option value="daily">每天</option><option value="once">指定时间一次</option><option value="interval">固定间隔</option></select></label><label id="ai-task-daily-label">本机时间<input id="ai-task-time" type="time" value="09:00"></label><label id="ai-task-once-label" hidden>日期与时间<input id="ai-task-at" type="datetime-local"></label><label id="ai-task-interval-label" hidden>间隔（分钟）<input id="ai-task-minutes" type="number" min="5" max="525600" value="60"></label></div><div class="ai-columns"><label>存入分类<select id="ai-task-category"></select></label><label class="ai-check"><input id="ai-task-current" type="checkbox"> 仅使用当前文档作为资料</label></div><label class="ai-check"><input id="ai-task-enabled" type="checkbox" checked> 启用任务</label><div class="ai-actions"><button class="solid" type="submit">保存任务</button><button id="ai-task-reset" type="button">新建另一任务</button></div></form></section>
    <section data-ai-page="guide" hidden><p class="ai-muted">连接外部 AI 时，先读取 /v1/guide 和 /v1/tools。内置助手会自动收到同一份能力说明。</p><button id="ai-copy-guide">复制 AI 指引</button><pre id="ai-guide-text"></pre></section>`;
  overlay.append(panel);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    panel.querySelector<T>(`#${id}`)!;
  const value = (id: string) => $<HTMLInputElement>(id).value.trim();
  const checked = (id: string) => $<HTMLInputElement>(id).checked;
  const message = (text: string) => {
    $("ai-status").textContent = text;
  };
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: true,
  });
  let state: Awaited<ReturnType<NonNullable<Window["rhineAI"]>["state"]>>;
  let taskId: string | undefined;
  let taskScope: string[] | undefined;
  let running = false;
  let openSession = 0;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let opener: Element | null;
  const action = async (fn: () => Promise<unknown>) => {
    try {
      if (!api) throw Error("此程序未提供 AI 接口，请使用更新后的客户端。");
      await fn();
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    }
  };
  function tab(name: string) {
    panel
      .querySelectorAll<HTMLElement>("[data-ai-page]")
      .forEach((el) => (el.hidden = el.dataset.aiPage !== name));
    panel.querySelectorAll<HTMLElement>("[data-ai-tab]").forEach((el) => {
      el.classList.toggle("active", el.dataset.aiTab === name);
      el.setAttribute("aria-pressed", String(el.dataset.aiTab === name));
    });
  }
  function connection() {
    const config = state.settings;
    $<HTMLInputElement>("ai-enabled").checked = config.enabled;
    $<HTMLInputElement>("ai-base").value = config.baseUrl;
    $<HTMLInputElement>("ai-model").value = config.model;
    $<HTMLInputElement>("ai-embedding").value = config.embeddingModel;
    $<HTMLInputElement>("ai-key").placeholder = config.hasKey
      ? "密钥已加密保存，留空保留"
      : "无需密钥的本地接口可留空";
    $<HTMLInputElement>("ai-http-enabled").checked = state.http.enabled;
    $<HTMLInputElement>("ai-http-write").checked = state.http.allowWrite;
    $<HTMLInputElement>("ai-http-port").value = String(
      state.http.requestedPort || 0,
    );
    const info = $("ai-http-info");
    info.replaceChildren();
    if (state.http.enabled) {
      const address = state.http.url || state.http.endpoint || "";
      const endpoint = document.createElement("code");
      endpoint.textContent = address;
      const key = document.createElement("input");
      key.type = "password";
      key.readOnly = true;
      key.value = state.http.token || "";
      key.setAttribute("aria-label", "本机 API 令牌");
      const copy = document.createElement("button");
      copy.textContent = "复制接入信息";
      copy.onclick = () =>
        action(async () => {
          await api!.copy("connection");
          message("接入信息已复制，请仅交给可信的本机工具。");
        });
      info.append(endpoint, key, copy);
    } else info.textContent = "API 已关闭";
    if (state.http.error) {
      const error = document.createElement("p");
      error.textContent = state.http.error;
      info.append(error);
    }
  }
  function categories() {
    const select = $<HTMLSelectElement>("ai-task-category"),
      old = select.value;
    select.replaceChildren(
      new Option("未分类", ""),
      ...hooks.categories().map((c) => new Option(c.name, c.id)),
    );
    select.value = old;
  }
  function tasks() {
    const list = $("ai-task-list");
    list.replaceChildren();
    if (!state.tasks.length) {
      const p = document.createElement("p");
      p.className = "ai-muted";
      p.textContent = "尚未安排定时文档。";
      list.append(p);
    }
    for (const task of state.tasks) {
      const row = document.createElement("div");
      row.className = "ai-task-row";
      const heading = document.createElement("strong");
      heading.textContent = task.title;
      const labels: Record<string, string> = {
        scheduled: "待执行",
        paused: "已暂停",
        running: "生成中",
        queued: "等待执行",
        completed: "已完成",
        failed: "执行失败",
        cancelled: "已停止",
      };
      const detail = document.createElement("small");
      detail.textContent = `${task.enabled ? "启用" : "暂停"} · ${labels[task.status || ""] || "待执行"}${task.nextRun ? " · 下次 " + new Date(task.nextRun).toLocaleString() : ""}${task.lastError ? " · " + (typeof task.lastError === "string" ? task.lastError : task.lastError.message) : ""}`;
      const actions = document.createElement("div");
      actions.className = "ai-actions";
      const button = (label: string, fn: () => Promise<unknown>) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.onclick = () => action(fn);
        actions.append(b);
      };
      button("编辑", async () => {
        taskId = task.id;
        taskScope = task.documentIds;
        $("ai-task-heading").textContent = "编辑定时文档";
        $<HTMLInputElement>("ai-task-title").value = task.title;
        $<HTMLTextAreaElement>("ai-task-prompt").value = task.prompt;
        $<HTMLSelectElement>("ai-task-type").value = task.schedule.type;
        $<HTMLInputElement>("ai-task-time").value =
          task.schedule.time || "09:00";
        if (task.schedule.at) {
          const date = new Date(task.schedule.at);
          $<HTMLInputElement>("ai-task-at").value = new Date(
            date.getTime() - date.getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16);
        }
        $<HTMLInputElement>("ai-task-minutes").value = String(
          task.schedule.minutes || 60,
        );
        $<HTMLSelectElement>("ai-task-category").value = task.categoryId || "";
        $<HTMLInputElement>("ai-task-enabled").checked = task.enabled;
        $<HTMLInputElement>("ai-task-current").checked =
          !!task.documentIds?.length;
        scheduleFields();
      });
      button(task.enabled ? "暂停" : "启用", async () => {
        await api!.saveTask({ ...task, enabled: !task.enabled });
        await reloadTasks();
      });
      button("立即运行", async () => {
        message("正在生成任务文档…");
        await api!.runTask(task.id);
        await reloadTasks();
        await hooks.changed();
        message("任务已执行，请查看新文档和任务状态。");
      });
      if (task.status === "running")
        button("停止本次", async () => {
          await api!.cancel();
          message("已请求停止任务，已完成的文档会保留。");
          await reloadTasks();
        });
      if (task.lastDocId)
        button("查看文档", async () => {
          await hooks.navigate(task.lastDocId!);
          close();
        });
      button("移除任务", async () => {
        if (!confirm(`移除任务“${task.title}”？已经生成的文档会保留。`)) return;
        await api!.removeTask(task.id);
        await reloadTasks();
      });
      row.append(heading, detail, actions);
      list.append(row);
    }
  }
  async function reloadTasks() {
    state.tasks = await api!.tasks();
    tasks();
  }
  function scheduleFields() {
    const type = value("ai-task-type");
    $("ai-task-daily-label").hidden = type !== "daily";
    $("ai-task-once-label").hidden = type !== "once";
    $("ai-task-interval-label").hidden = type !== "interval";
  }
  function resetTask() {
    $<HTMLFormElement>("ai-task-form").reset();
    taskId = undefined;
    taskScope = undefined;
    $("ai-task-heading").textContent = "新建定时文档";
    categories();
    scheduleFields();
  }
  const disabledBeforeLoad = new Map<
    | HTMLInputElement
    | HTMLButtonElement
    | HTMLSelectElement
    | HTMLTextAreaElement,
    boolean
  >();
  function loading(value: boolean) {
    if (value)
      panel
        .querySelectorAll<
          | HTMLInputElement
          | HTMLButtonElement
          | HTMLSelectElement
          | HTMLTextAreaElement
        >("input,button:not(#ai-close),select,textarea")
        .forEach((el) => {
          disabledBeforeLoad.set(el, el.disabled);
          el.disabled = true;
        });
    else {
      for (const [el, disabled] of disabledBeforeLoad) el.disabled = disabled;
      disabledBeforeLoad.clear();
    }
  }
  function close() {
    openSession++;
    panel.close();
    loading(false);
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    (opener as HTMLElement)?.focus({ preventScroll: true });
  }
  $("ai-close").onclick = close;
  panel.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  panel.addEventListener("keydown", (event) => event.stopPropagation());
  panel.querySelectorAll<HTMLElement>("[data-ai-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        tab(button.dataset.aiTab!);
        if (button.dataset.aiTab === "tasks") void action(reloadTasks);
      }),
  );
  $("ai-settings").onsubmit = (event) => {
    event.preventDefault();
    void action(async () => {
      state.settings = await api!.saveSettings({
        enabled: checked("ai-enabled"),
        baseUrl: value("ai-base"),
        model: value("ai-model"),
        embeddingModel: value("ai-embedding"),
        ...(value("ai-key") ? { apiKey: value("ai-key") } : {}),
        clearKey: checked("ai-clear-key"),
      });
      $<HTMLInputElement>("ai-key").value = "";
      $<HTMLInputElement>("ai-clear-key").checked = false;
      connection();
      message("接入设置已保存。向量模型可留空，普通搜索始终离线可用。");
    });
  };
  $("ai-test").onclick = () =>
    action(async () => {
      message("正在测试已保存的连接…");
      await api!.test();
      message("连接正常。");
    });
  const configureHTTP = (rotateToken = false) =>
    action(async () => {
      state.http = await api!.configureHTTP({
        enabled: checked("ai-http-enabled"),
        allowWrite: checked("ai-http-write"),
        port: Number(value("ai-http-port")),
        rotateToken,
      });
      connection();
      message(
        state.http.running
          ? "本机 API 已启用。"
          : state.http.error || "本机 API 已关闭。",
      );
    });
  $("ai-http-save").onclick = () => configureHTTP();
  $("ai-http-rotate").onclick = () => configureHTTP(true);
  $("ai-task-type").onchange = scheduleFields;
  $("ai-task-reset").onclick = resetTask;
  $("ai-task-current").onchange = () => {
    taskScope =
      checked("ai-task-current") && hooks.selected()
        ? [hooks.selected()!.id]
        : undefined;
  };
  $("ai-task-form").onsubmit = (event) => {
    event.preventDefault();
    void action(async () => {
      const type = value("ai-task-type");
      const schedule =
        type === "daily"
          ? { type, time: value("ai-task-time") }
          : type === "interval"
            ? { type, minutes: Number(value("ai-task-minutes")) }
            : { type, at: new Date(value("ai-task-at")).toISOString() };
      if (checked("ai-task-current") && !taskScope?.length) {
        const doc = hooks.selected();
        if (!doc) throw Error("请先选择作为资料的文档。");
        taskScope = [doc.id];
      }
      await api!.saveTask({
        ...(taskId ? { id: taskId } : {}),
        title: value("ai-task-title"),
        prompt: value("ai-task-prompt"),
        categoryId: value("ai-task-category") || null,
        documentIds: checked("ai-task-current") ? taskScope : [],
        enabled: checked("ai-task-enabled"),
        schedule,
      });
      await reloadTasks();
      resetTask();
      message("任务已保存。程序运行时自动执行。");
    });
  };
  $("ai-send").onclick = () =>
    action(async () => {
      if (running) return;
      const prompt = value("ai-prompt");
      if (!prompt) throw Error("请填写你的要求。");
      const allowWrite = checked("ai-write");
      if (allowWrite && !(await hooks.beforeWrite())) return;
      running = true;
      $<HTMLButtonElement>("ai-send").disabled = true;
      $<HTMLButtonElement>("ai-stop").disabled = false;
      message("正在查询知识库并执行你的要求…");
      try {
        const result = await api!.run({
          prompt,
          documentId: checked("ai-current") ? hooks.selected()?.id : undefined,
          allowWrite,
        });
        $("ai-answer").innerHTML = markdown.render(
          result.text || "本次执行未返回正文，请查看操作记录。",
        );
        const refs = $("ai-references");
        refs.replaceChildren();
        for (const ref of result.references || []) {
          const button = document.createElement("button");
          button.textContent = ref.title || ref.id;
          button.onclick = () =>
            action(async () => {
              await hooks.navigate(ref.id);
              close();
            });
          refs.append(button);
        }
        $("ai-operations").hidden = !result.toolResults?.length;
        $("ai-operations").querySelector("pre")!.textContent = JSON.stringify(
          result.toolResults || [],
          null,
          2,
        );
        message(
          result.failed
            ? (result.error || "执行中断。") + " 已完成的操作保留，请查看记录。"
            : "本次执行完成。",
        );
      } finally {
        running = false;
        $<HTMLButtonElement>("ai-send").disabled = false;
        $<HTMLButtonElement>("ai-stop").disabled = true;
        await hooks.changed();
      }
    });
  $("ai-stop").onclick = () =>
    action(async () => {
      await api!.cancel();
      message("已请求停止。已完成的操作保留，不会自动撤销。");
    });
  $("ai-summary").onclick = () => {
    if (!hooks.selected()) {
      message("请先选择一篇文档。");
      return;
    }
    $<HTMLInputElement>("ai-current").checked = true;
    $<HTMLTextAreaElement>("ai-prompt").value =
      "请总结当前文档，列出要点、结论与待办；引用原文，不要编造缺失信息，也不要修改文档。";
    $("ai-prompt").focus();
  };
  $("ai-copy-guide").onclick = () =>
    action(async () => {
      await api!.copy("guide");
      message("AI 指引已复制。");
    });
  $("ai-answer").onclick = (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (link) {
      event.preventDefault();
      if (/^https?:\/\//i.test(link.href))
        void action(() => window.rhine.openExternal(link.href));
    }
  };
  return {
    async open() {
      const session = ++openSession;
      opener = document.activeElement;
      if (!panel.open) panel.showModal();
      loading(true);
      message("正在读取 AI 设置…");
      try {
        if (!api) throw Error("此程序未提供 AI 接口，请使用更新后的客户端。");
        const [next, guide] = await Promise.all([api.state(), api.guide()]);
        if (session !== openSession || !panel.open) return;
        state = next;
        connection();
        categories();
        tasks();
        $("ai-guide-text").textContent =
          typeof guide === "string" ? guide : JSON.stringify(guide, null, 2);
        message(
          state.settings.enabled
            ? "已接入模型，选择一项操作开始。"
            : "AI 未接入。可在接入设置中配置，原有功能不受影响。",
        );
        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
          if (panel.open && state) void action(reloadTasks);
        }, 15000);
      } catch (error) {
        if (session === openSession && panel.open)
          message(error instanceof Error ? error.message : String(error));
      } finally {
        if (session === openSession) loading(false);
      }
    },
    close,
    panel,
  };
}
