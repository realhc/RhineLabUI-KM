import "./desktop.css";
import { mountDirectoryWheel } from "./desktop-directory";
import MarkdownIt from "markdown-it";

const api = window.rhine;
const overlay = document.createElement("dialog");
overlay.id = "library-overlay";
overlay.setAttribute("aria-label", "本地知识库");
document.body.append(overlay);
let opener: HTMLElement | null = null;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  overlay.querySelector<T>(`#${id}`)!;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const read = (key: string, fallback: any): any => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
let dragged = "";
let documents: RhineDocument[] = [],
  trash: RhineDocument[] = [],
  selected: RhineDocument | undefined;
let dirty = false,
  saving = false,
  view = "all",
  filter = "",
  query = "",
  sort = read("rhine-library-sort", "manual"),
  page = 0,
  conflict = false;
const storedSaved = read("rhine-saved", []);
const saved = new Set<string>(
  (Array.isArray(storedSaved) ? storedSaved : []).filter(
    (s: unknown) => typeof s === "string",
  ),
);
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
// Attachments are deliberately not loaded: no local file disclosure or remote tracking requests.
md.renderer.rules.image = (tokens, index) =>
  `<span class="attachment">[图片：${escape(tokens[index].content)} — 首版暂不支持附件]</span>`;

overlay.innerHTML =
  `<header><div class="library-brand">RHINE LAB<small>ARCHIVE DIRECTORY / 本地知识库</small></div><div class="header-actions"><button id="refresh" title="刷新磁盘索引">刷新</button><button id="folder">打开知识库文件夹 ↗</button><button id="preferences">设置</button><button id="fullscreen" title="F11 全屏 / Esc 退出">⛶</button><button id="library-close" aria-label="关闭知识库">CLOSE ×</button></div></header>
<div class="shell"><aside><div class="row" style="justify-content:space-between"><span class="eyebrow">ARCHIVE DIRECTORY</span><button id="new" class="solid">＋ 新建</button></div><input id="search" type="search" placeholder="搜索标题、分类和正文…" aria-label="全文搜索"/><div class="nav"><button data-view="all" class="active">全部</button><button data-view="saved">收藏</button><button data-view="trash">回收区</button></div><div class="filters"><select id="filter" aria-label="分类"><option value="">全部分类</option></select><select id="sort" aria-label="排序"><option value="manual">手动顺序</option><option value="title">标题 A–Z</option><option value="modified">最近修改</option></select></div><div class="directory-wheel"><div id="documents" role="list" aria-label="文档刻度目录"></div></div><div class="side-footer"><span id="count"></span><br>本地 Markdown · 数据位于程序旁<br>上下拖动 / 滚轮浏览 · 拖动 ⋮⋮ 调整顺序</div></aside>
<main><div id="notice" role="alert"></div><section id="empty-main" class="empty"><div class="eyebrow">NO ARCHIVE SELECTED</div><h2>从一份记录开始</h2><p>选择左侧档案，或新建一篇 Markdown 文档。</p></section><section id="editor" hidden><div class="metadata"><input id="title" aria-label="文档标题" placeholder="文档标题" maxlength="240"/><input id="category" aria-label="文档分类" placeholder="未分类" list="categories" maxlength="120"/><datalist id="categories"></datalist></div><div class="toolbar"><div class="row"><button id="save" class="solid" title="Ctrl+S">保存</button><button id="favorite">☆ 收藏</button><button id="remove" class="danger">移入回收区</button><button id="restore" hidden>恢复</button><button id="purge" class="danger" hidden>永久删除</button></div><div class="mode"><button data-mode="source">源码</button><button data-mode="split" class="active">分栏</button><button data-mode="preview">阅读</button></div></div><div id="format" class="row"><button data-wrap="**" title="Ctrl+B">B 粗体</button><button data-wrap="*" title="Ctrl+I">I 斜体</button><button data-prefix="## ">H 标题</button><button data-prefix="- ">列表</button><button data-prefix="> ">引用</button><button data-wrap="&#96;">代码</button></div><div id="panes" class="split"><textarea id="body" aria-label="Markdown 源码" spellcheck="false" placeholder="写下你的第一行 Markdown…"></textarea><article id="preview" aria-label="Markdown 预览"></article></div><div id="document-info"></div></section></main></div><footer><span>RHINE LAB · OFFLINE WORKSPACE</span><span id="state" role="status" aria-live="polite">正在读取知识库…</span></footer><dialog id="dialog"><h2 id="dialog-title"></h2><p id="dialog-copy"></p><div class="row" id="dialog-actions"></div></dialog><input id="import-file" type="file" accept="application/json,.json" hidden/>`;

const directoryWheel = mountDirectoryWheel($("documents"));

function notify(message: string) {
  $("notice").textContent = message;
  $("notice").classList.add("visible");
}
function error(err: unknown) {
  notify(err instanceof Error ? err.message : String(err));
  $("state").textContent = "操作失败 · 内容仍保留在编辑器中";
}
function status(message: string) {
  $("state").textContent = message;
}
function setDirty(value: boolean) {
  dirty = value;
  api?.setDirty(value);
  status(value ? "● 未保存 · Ctrl+S 保存" : "已保存到本地 Markdown");
}
function dialog(
  title: string,
  copy: string,
  choices: [string, string][],
): Promise<string> {
  return new Promise((resolve) => {
    const el = $<HTMLDialogElement>("dialog");
    $("dialog-title").textContent = title;
    $("dialog-copy").textContent = copy;
    $("dialog-actions").innerHTML = choices
      .map(
        ([id, label]) =>
          `<button data-choice="${id}">${escape(label)}</button>`,
      )
      .join("");
    const finish = (choice: string) => {
      el.close();
      el.oncancel = null;
      $("dialog-actions").onclick = null;
      resolve(choice);
    };
    $("dialog-actions").onclick = (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-choice]",
      );
      if (button) finish(button.dataset.choice!);
    };
    el.oncancel = (e) => {
      e.preventDefault();
      finish("cancel");
    };
    el.showModal();
  });
}
async function canLeave() {
  if (saving) return false;
  if (!dirty) return true;
  const result = await dialog(
    "此文档有未保存的修改",
    "保存后继续，或放弃编辑器中的修改。取消可返回继续编辑。",
    [
      ["cancel", "取消"],
      ["discard", "放弃修改"],
      ["save", "保存并继续"],
    ],
  );
  if (result === "save") return save();
  if (result === "discard") {
    setDirty(false);
    return true;
  }
  return false;
}
function visible() {
  const source = view === "trash" ? trash : documents;
  return source
    .filter(
      (d) =>
        (!filter || d.category === filter) &&
        (view !== "saved" || saved.has(d.id)) &&
        (!query ||
          `${d.title}\n${d.category}\n${d.body}`
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : sort === "modified"
          ? b.modified.localeCompare(a.modified)
          : a.order - b.order || a.id.localeCompare(b.id),
    );
}
function renderList() {
  if (dragged) return;
  const list = visible();
  const previousScroll = $("documents").scrollTop;
  const previousSelection = $("documents").querySelector<HTMLElement>(".selected")?.dataset.id;
  const focusedId = $("documents").contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.id : undefined;
  $("documents").innerHTML = list.length
    ? list
        .map(
          (d) =>
            `<button role="listitem" class="document ${selected?.id === d.id ? "selected" : ""}" data-id="${escape(d.id)}" aria-current="${selected?.id === d.id ? "true" : "false"}"><span class="directory-label"><strong>${saved.has(d.id) ? "★ " : ""}${escape(d.title)}</strong><small>${escape(d.category || "未分类")} · ${escape(d.modified.slice(0, 10))}</small></span>${sort === "manual" && view !== "trash" ? '<span class="directory-reorder" draggable="true" title="拖动调整文档顺序" aria-hidden="true">⋮⋮</span>' : ""}</button>`,
        )
        .join("")
    : '<div class="empty">没有匹配的文档</div>';
  $("documents").scrollTop = previousScroll;
  if (focusedId) Array.from($("documents").querySelectorAll<HTMLElement>(".document")).find(el => el.dataset.id === focusedId)?.focus({preventScroll:true});
  if (overlay.open && selected?.id !== previousSelection) $("documents").querySelector<HTMLElement>(".selected")?.scrollIntoView({block:"nearest"});
  directoryWheel.refresh();
  $("count").textContent =
    `${list.length} 篇显示 / ${documents.length} 篇文档 · 回收区 ${trash.length}`;
  const categories = [
    ...new Set(documents.map((d) => d.category).filter(Boolean)),
  ].sort();
  $("filter").innerHTML =
    '<option value="">全部分类</option>' +
    categories.map((c) => `<option>${escape(c)}</option>`).join("");
  if (filter && !categories.includes(filter))
    $("filter").insertAdjacentHTML(
      "beforeend",
      `<option>${escape(filter)}</option>`,
    );
  ($("filter") as HTMLSelectElement).value = filter;
  $("categories").innerHTML = categories
    .map((c) => `<option value="${escape(c)}"></option>`)
    .join("");

}
function preview() {
  $("preview").innerHTML = md.render($<HTMLTextAreaElement>("body").value);
}
function renderEditor() {
  $("editor").hidden = !selected;
  $("empty-main").hidden = !!selected;
  if (!selected) return;
  const removed = trash.some((d) => d.id === selected!.id);
  $<HTMLInputElement>("title").value = selected.title;
  $<HTMLInputElement>("category").value = selected.category;
  $<HTMLTextAreaElement>("body").value = selected.body;
  for (const id of ["title", "category", "body"])
    ($(id) as HTMLInputElement).readOnly = removed;
  for (const id of ["save", "favorite", "remove", "format"])
    $(id).hidden = removed;
  for (const id of ["restore", "purge"]) $(id).hidden = !removed;
  $("favorite").textContent = saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏";
  $("document-info").textContent =
    `${selected.id} · 修改 ${new Date(selected.modified).toLocaleString()}${removed ? " · 回收区（只读）" : ""}`;
  preview();
}
async function select(id: string) {
  if (selected?.id === id) return;
  if (!(await canLeave())) return;
  selected = [...documents, ...trash].find((d) => d.id === id);
  const index = visible().findIndex((d) => d.id === id);
  if (index >= 0) page = Math.floor(index / 20);
  conflict = false;
  setDirty(false);
  renderEditor();
  renderList();
}
let refreshVersion = 0;
async function refresh() {
  const version = ++refreshVersion;
  const data = await api.list();
  if (version !== refreshVersion) return;
  documents = data.documents;
  window.dispatchEvent(new CustomEvent("rhine-library-changed", {detail:documents}));
  trash = data.trash;
  if (data.issues?.length)
    notify(
      `知识库中有 ${data.issues.length} 项索引问题：${data.issues.map((i) => (typeof i === "string" ? i : JSON.stringify(i))).join("；")}`,
    );
  if (selected) {
    const current = [...documents, ...trash].find((d) => d.id === selected!.id);
    if (
      !saving &&
      dirty &&
      (!current || current.revision !== selected.revision)
    ) {
      conflict = true;
      notify(
        "此文档已在外部修改或删除。编辑内容仍保留；保存时可另存副本，或放弃修改后重新载入。",
      );
    } else if (!saving && !dirty) {
      selected = current;
      renderEditor();
    }
  }
  renderList();
}
async function save(): Promise<boolean> {
  if (!selected || saving) return false;
  if (!dirty) return true;
  const payload = {
    id: selected.id,
    title: $<HTMLInputElement>("title").value.trim() || "未命名文档",
    category: $<HTMLInputElement>("category").value.trim() || "未分类",
    body: $<HTMLTextAreaElement>("body").value,
    revision: selected.revision,
  };
  if (conflict) {
    const choice = await dialog(
      "外部修改冲突",
      "为保护磁盘上的版本，可将当前编辑内容另存为新文档，或放弃当前修改并重新载入磁盘版本。",
      [
        ["cancel", "取消"],
        ["reload", "放弃并载入"],
        ["copy", "另存副本"],
      ],
    );
    if (choice === "reload") {
      setDirty(false);
      conflict = false;
      await refresh();
      return true;
    }
    if (choice !== "copy") return false;
    const base = payload.title + "（冲突副本）";
    let title = base,
      count = 2;
    while (
      documents.some(
        (d) => d.title.toLocaleLowerCase() === title.toLocaleLowerCase(),
      )
    )
      title = base + " " + count++;
    $("editor").inert = true;
    try {
      selected = await api.create({ ...payload, title });
      setDirty(false);
      conflict = false;
      await refresh();
      renderEditor();
      return true;
    } catch (err) {
      error(err);
      return false;
    } finally {
      $("editor").inert = false;
    }
  }
  saving = true;
  $<HTMLButtonElement>("save").disabled = true;
  status("正在保存…");
  // Keep an edit made while the IPC request is pending dirty against the new revision.
  try {
    const result = await api.save(payload);
    selected = result;
    const changed =
      $<HTMLInputElement>("title").value.trim() !== payload.title ||
      ($<HTMLInputElement>("category").value.trim() || "未分类") !==
        payload.category ||
      $<HTMLTextAreaElement>("body").value !== payload.body;
    setDirty(changed);
    await refresh();
    if (!changed) renderEditor();
    return !changed;
  } catch (err) {
    saving = false;
    error(err);
    await refresh().catch(() => {});
    return false;
  } finally {
    saving = false;
    $<HTMLButtonElement>("save").disabled = false;
  }
}
async function create() {
  if (!(await canLeave())) return;
  const previous = selected;
  let title = "未命名文档",
    count = 2;
  while (documents.some((d) => d.title === title))
    title = "未命名文档 " + count++;
  selected = undefined;
  renderEditor();
  $<HTMLButtonElement>("new").disabled = true;
  try {
    selected = await api.create({
      title,
      category: filter || "未分类",
      body: "",
    });
    view = "all";
    query = "";
    $<HTMLInputElement>("search").value = "";
    setDirty(false);
    await refresh();
    renderEditor();
    updateNav();
    $<HTMLInputElement>("title").focus();
    $<HTMLInputElement>("title").select();
  } catch (err) {
    selected = previous;
    renderEditor();
    throw err;
  } finally {
    $<HTMLButtonElement>("new").disabled = false;
  }
}
function updateNav() {
  overlay
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
}
let operations: Promise<unknown> = Promise.resolve();
function run(action: () => unknown) {
  operations = operations.then(action).catch(error);
  return operations;
}
$("refresh").onclick = () => run(refresh);
$("new").onclick = () => run(create);
$("save").onclick = () => run(save);
$("folder").onclick = () => run(() => api.openFolder());
$("fullscreen").onclick = () => run(() => api.fullscreen());
$("search").oninput = () => {
  query = $<HTMLInputElement>("search").value.trim().toLocaleLowerCase();
  page = 0;
  renderList();
};
$("filter").onchange = () => {
  filter = $<HTMLSelectElement>("filter").value;
  page = 0;
  renderList();
};
$("sort").onchange = () => {
  sort = $<HTMLSelectElement>("sort").value;
  localStorage.setItem("rhine-library-sort", JSON.stringify(sort));
  page = 0;
  renderList();
};
overlay.querySelectorAll<HTMLElement>("[data-view]").forEach(
  (el) =>
    (el.onclick = () =>
      run(async () => {
        if (!(await canLeave())) return;
        view = el.dataset.view!;
        selected = undefined;
        filter = "";
        page = 0;
        updateNav();
        renderEditor();
        renderList();
      })),
);
$("documents").onclick = (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
  if (el) run(() => select(el.dataset.id!));
};
for (const id of ["title", "category", "body"])
  $(id).oninput = () => {
    setDirty(true);
    if (id === "body") preview();
  };
$("favorite").onclick = () => {
  if (!selected) return;
  saved.has(selected.id) ? saved.delete(selected.id) : saved.add(selected.id);
  localStorage.setItem("rhine-saved", JSON.stringify([...saved]));
  $("favorite").textContent = saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏";
  renderList();
};
$("remove").onclick = () =>
  run(async () => {
    if (!selected || !(await canLeave())) return;
    const d = selected;
    if (
      (await dialog("移入回收区", `“${d.title}”将移入回收区，可随时恢复。`, [
        ["cancel", "取消"],
        ["delete", "移入回收区"],
      ])) !== "delete"
    )
      return;
    await api.trash(d.id, d.revision);
    selected = undefined;
    await refresh();
    renderEditor();
  });
$("restore").onclick = () =>
  run(async () => {
    if (!selected) return;
    const id = selected.id;
    await api.restore(id);
    view = "all";
    filter = "";
    query = "";
    $<HTMLInputElement>("search").value = "";
    updateNav();
    await refresh();
    selected = documents.find((d) => d.id === id);
    renderEditor();
    renderList();
  });
$("purge").onclick = () =>
  run(async () => {
    if (!selected) return;
    if (
      (await dialog(
        "永久删除文档",
        `永久删除“${selected.title}”后无法从回收区恢复。`,
        [
          ["cancel", "取消"],
          ["purge", "确认永久删除"],
        ],
      )) !== "purge"
    )
      return;
    await api.purge(selected.id);
    selected = undefined;
    await refresh();
    renderEditor();
  });
overlay.querySelectorAll<HTMLElement>("[data-mode]").forEach(
  (el) =>
    (el.onclick = () => {
      $("panes").className = el.dataset.mode!;
      overlay
        .querySelectorAll("[data-mode]")
        .forEach((b) => b.classList.toggle("active", b === el));
    }),
);
function format(wrap?: string, prefix?: string) {
  const el = $<HTMLTextAreaElement>("body");
  if (el.readOnly || !selected) return;
  const start = el.selectionStart,
    end = el.selectionEnd;
  const text = el.value.slice(start, end);
  el.setRangeText(
    wrap ? wrap + text + wrap : prefix + text,
    start,
    end,
    "select",
  );
  el.focus();
  setDirty(true);
  preview();
}
$("format").onclick = (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (button) format(button.dataset.wrap, button.dataset.prefix);
};
$("preview").onclick = (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") || "";
  if (/^https?:\/\//i.test(href)) run(() => api.openExternal(href));
  else notify("仅支持通过系统浏览器打开 http / https 外链。");
};
document.addEventListener("keydown", (e) => {
  if (!overlay.open) return;
  if ($<HTMLDialogElement>("dialog").open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    run(save);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    run(create);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("search").focus();
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    document.activeElement === $("body") &&
    ["b", "i"].includes(e.key.toLowerCase())
  ) {
    e.preventDefault();
    format(e.key.toLowerCase() === "b" ? "**" : "*");
  }
});

$("documents").ondragstart = (e) => {
  if (!(e.target as HTMLElement).closest(".directory-reorder") || sort !== "manual" || view === "trash") { e.preventDefault(); return; }
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
  dragged = el?.dataset.id || "";
  e.dataTransfer?.setData("text/plain", dragged);
};
$("documents").ondragend = () => {
  dragged = "";
  renderList();
};
$("documents").ondragover = (e) => {
  if (sort === "manual" && view !== "trash") e.preventDefault();
};
$("documents").ondrop = (e) => {
  e.preventDefault();
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")
    ?.dataset.id;
  if (
    !target ||
    !dragged ||
    target === dragged ||
    sort !== "manual" ||
    view === "trash"
  )
    return;
  const movingId = dragged;
  run(async () => {
    if (!(await canLeave())) return;
    const ids = [...documents]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((d) => d.id);
    const from = ids.indexOf(movingId);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(ids.indexOf(target), 0, movingId);
    await api.reorder(ids);
    await refresh();
    status("手动顺序已保存");
  });
};


$("preferences").onclick = () => run(async () => {
  if (await closeLibrary()) window.dispatchEvent(new CustomEvent("rhine-open-settings"));
});
$("library-close").onclick = () => run(closeLibrary);
overlay.addEventListener("cancel", event => { event.preventDefault(); run(closeLibrary); });
async function closeLibrary() {
  if (!(await canLeave())) return false;
  overlay.close();
  window.dispatchEvent(new CustomEvent("rhine-library-visibility", {detail:false}));
  window.dispatchEvent(new CustomEvent("rhine-library-selected", {detail:selected?.id}));
  opener?.focus({preventScroll:true});
  return true;
}
export async function openLibrary(id?: string, requestedView: "all" | "saved" | "trash" = "all") {
  return run(async () => {
    if (overlay.open && !(await canLeave())) return;
    opener = document.activeElement as HTMLElement;
    saved.clear();
    const stored = read("rhine-saved", []);
    if (Array.isArray(stored)) stored.filter(value => typeof value === "string").forEach(value => saved.add(value));
    view = requestedView; query = ""; filter = "";
    $("notice").classList.remove("visible");
    $<HTMLInputElement>("search").value = "";
    $<HTMLSelectElement>("sort").value = sort;
    await refresh();
    if (id) await select(id);
    else { selected = undefined; renderEditor(); }
    updateNav(); renderList();
    if (!overlay.open) overlay.showModal();
    window.dispatchEvent(new CustomEvent("rhine-library-visibility", {detail:true}));
    $(id ? "title" : "search").focus();
  });
}
let timer: ReturnType<typeof setTimeout>;
api.onChanged(() => {
  if (!overlay.open) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(refresh), 220);
});
