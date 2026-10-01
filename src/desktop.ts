import "./desktop.css";
import { mountDirectoryWheel } from "./desktop-directory";
import { mountLibraryMotion } from "./desktop-library-motion";
import { mountRichEditor, richToolbar } from "./desktop-rich-editor";

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
let directoryCategories: RhineCategory[] = [];
let activeCategory: string | null = null;
const collapsed = new Set<string>(read("rhine-directory-collapsed", []));
let documents: RhineDocument[] = [],
  trash: RhineDocument[] = [],
  selected: RhineDocument | undefined;
let editing = false;
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
overlay.innerHTML =
  `<header><div class="library-brand">RHINE LAB<small>ARCHIVE DIRECTORY / 本地知识库</small></div><div class="header-actions"><button id="refresh" title="刷新磁盘索引">刷新</button><button id="folder">打开知识库文件夹 ↗</button><button id="preferences">设置</button><button id="fullscreen" title="F11 全屏 / Esc 退出">⛶</button><button id="library-close" aria-label="关闭知识库">CLOSE ×</button></div></header>
<div class="shell"><aside><div class="row" style="justify-content:space-between"><span class="eyebrow">ARCHIVE DIRECTORY</span><div class="directory-add"><button id="new" class="solid" aria-label="新建分类或文档" aria-expanded="false">＋</button><div id="new-menu" hidden><button id="new-category">新建分类</button><button id="new-document">新建文档</button></div></div></div><input id="search" type="search" placeholder="搜索标题、分类和正文…" aria-label="全文搜索"/><div class="nav"><button data-view="all" class="active">全部</button><button data-view="saved">收藏</button><button data-view="trash">回收区</button></div><div class="filters"><select id="sort" aria-label="排序"><option value="manual">手动顺序</option><option value="title">标题 A–Z</option><option value="modified">最近修改</option></select></div><div class="directory-wheel"><div id="documents" role="list" aria-label="文档刻度目录"></div></div><div class="side-footer"><span id="count"></span><br>本地 Markdown · 数据位于程序旁<br>上下拖动 / 滚轮浏览 · 拖动文档条归类 / 排序</div></aside>
<main><div id="notice" role="alert"></div><section id="empty-main" class="empty"><div class="eyebrow">NO ARCHIVE SELECTED</div><h2>从一份记录开始</h2><p>选择左侧档案，或新建一篇文档。</p></section><section id="editor" hidden><div class="metadata"><input id="title" aria-label="文档标题" placeholder="文档标题" maxlength="240"/></div><div class="toolbar"><div class="row"><button id="save" class="solid" title="E 编辑 / Ctrl+S 保存">编辑</button><button id="favorite">☆ 收藏</button><button id="remove" class="danger">移入回收区</button><button id="restore" hidden>恢复</button><button id="purge" class="danger" hidden>永久删除</button></div></div><div id="format" class="row" role="toolbar" aria-label="正文编辑工具">${richToolbar}</div><div id="panes" class="preview"><article id="preview" aria-label="文档正文"></article></div><div id="document-info"></div></section></main></div><footer><span>RHINE LAB · OFFLINE WORKSPACE</span><span id="state" role="status" aria-live="polite">正在读取知识库…</span></footer><dialog id="dialog"><h2 id="dialog-title"></h2><p id="dialog-copy"></p><div class="row" id="dialog-actions"></div></dialog><input id="import-file" type="file" accept="application/json,.json" hidden/>`;

// Regroup existing nodes without changing document operations.
const controls = document.createElement("section");
controls.className = "library-controls";
controls.setAttribute("aria-label", "文档与知识库操作");
controls.append(overlay.querySelector("header")!);
const documentHeading = document.createElement("div");
documentHeading.className = "document-heading";
for (const selector of [".metadata", ".toolbar"])
  documentHeading.append(overlay.querySelector(selector)!);
controls.append(documentHeading, overlay.querySelector("#format")!);
controls.append(overlay.querySelector("footer")!);
overlay.append(controls);

const libraryMotion = mountLibraryMotion(overlay);
const directoryWheel = mountDirectoryWheel($("documents"), () => libraryMotion.enabled("dragMomentum"));
const rich = mountRichEditor($("preview"),$("format"), () => setDirty(true), requestEditorInput);

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
  const list = visible(), el = $("documents"), scroll = el.scrollTop;
  const focused = (document.activeElement as HTMLElement)?.dataset.id;
  const previousSelection = el.querySelector<HTMLElement>(".selected")?.dataset.id;
  const documentRow = (d:RhineDocument) => `<button role="listitem" class="document ${selected?.id===d.id?"selected":""}" draggable="${view!=="trash"}" title="拖动文档条：归类或排序" data-id="${escape(d.id)}" aria-current="${selected?.id===d.id}"><span class="directory-label"><strong>${saved.has(d.id)?"★ ":""}${escape(d.title)}</strong><small>${escape(d.modified.slice(0,10))}</small></span>${view!=="trash"?'<span class="directory-reorder" title="拖动文档条：归类或排序" aria-hidden="true">⋮⋮</span>':""}</button>`;
  const groupRow = (id:string|null,name:string,items:RhineDocument[]) => {
    const shut = !!id && collapsed.has(id) && !query;
    return `<section class="category-group" data-drop-category="${id??""}"><div class="category-tick ${activeCategory===id?"active":""}" data-category-id="${id??""}"><button class="category-toggle" data-collapse="${id??""}" aria-expanded="${!shut}" ${items.length?"":"data-empty=true"}><span class="category-arrow">${items.length?(shut?"▸":"▾"):"·"}</span><strong>${escape(name)}</strong><small>${items.length}</small></button>${id&&view!=="trash"?`<span class="category-actions"><button data-category-action="add" title="在分类中新增文档">＋</button><button data-category-action="rename" title="重命名分类">✎</button><button data-category-action="remove" title="移除分类，保留文档">×</button></span>`:""}</div>${!shut?items.map(documentRow).join(""):""}</section>`;
  };
  el.innerHTML = directoryCategories.filter(c=>view==="all"&&!query||list.some(d=>d.categoryId===c.id)).map(c=>groupRow(c.id,c.name,list.filter(d=>d.categoryId===c.id))).join("") + groupRow(null,"未分类",list.filter(d=>!d.categoryId));
  if(!list.length && (query||view!=="all")) el.insertAdjacentHTML("beforeend",'<div class="empty">没有匹配的文档</div>');
  el.scrollTop=scroll;
  if(focused)Array.from(el.querySelectorAll<HTMLElement>(".document")).find(row=>row.dataset.id===focused)?.focus({preventScroll:true});
  if(overlay.open&&selected?.id!==previousSelection)el.querySelector<HTMLElement>(".selected")?.scrollIntoView({block:"nearest"});
  directoryWheel.refresh();
  $("count").textContent=`${list.length} 篇文档 · ${directoryCategories.length} 个分类 · 回收区 ${trash.length}`;
}


let displayedDocumentId: string | undefined;
function renderEditor() {
  const changedDocument = displayedDocumentId !== selected?.id;
  displayedDocumentId = selected?.id;
  overlay.dataset.editing = String(editing && !!selected);
  $("editor").hidden = !selected;
  $("empty-main").hidden = !!selected;
  if (!selected) { editing = false; rich.setEditable(false); return; }
  const removed = trash.some((d) => d.id === selected!.id);
  $<HTMLInputElement>("title").value = selected.title;
  rich.load(selected.body,selected.id);
  rich.setEditable(editing && !removed);
  $<HTMLInputElement>("title").readOnly = removed || !editing;
  $("save").textContent = editing ? "保存" : "编辑";
  $("save").title = editing ? "Ctrl+S 保存（继续编辑）" : "E 编辑";
  for (const id of ["save", "favorite", "remove", "format"])
    $(id).hidden = removed;
  for (const id of ["restore", "purge"]) $(id).hidden = !removed;
  $("favorite").textContent = saved.has(selected.id) ? "★ 已收藏" : "☆ 收藏";
  $("document-info").textContent =
    `${selected.id} · 修改 ${new Date(selected.modified).toLocaleString()}${removed ? " · 回收区（只读）" : ""}`;
  if (changedDocument) libraryMotion.revealDocument();
}
async function select(id: string) {
  if (selected?.id === id) { activeCategory = selected.categoryId ?? null; renderList(); return; }
  if (!(await canLeave())) return;
  editing = false;
  selected = [...documents, ...trash].find((d) => d.id === id);
  activeCategory = selected?.categoryId ?? null;
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
  directoryCategories = data.categories;
  if(activeCategory&&!directoryCategories.some(c=>c.id===activeCategory))activeCategory=null;
  window.dispatchEvent(new CustomEvent("rhine-library-changed", {detail:data}));
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
    category: selected.category,
    body: rich.body(),
    revision: selected.revision,
    categoryId: selected.categoryId ?? null,
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
    activeCategory = result.categoryId ?? null;
    const changed =
      $<HTMLInputElement>("title").value.trim() !== payload.title ||
      rich.body() !== payload.body;
    setDirty(changed);
    await refresh();
    if (!changed) renderEditor();
    return !changed;
  } catch (err) {
    saving = false;
    error(err);
    await refresh().catch(() => {});
    // Recheck disk after a failed save: watcher notifications may still be queued,
    // and contextBridge does not preserve custom properties on rejected Errors.
    const latest = await api.list().catch(() => null);
    const current = latest?.documents.find(d => d.id === payload.id);
    if (latest && (!current || current.revision !== payload.revision)) {
      conflict = true;
      return await save();
    }
    return false;
  } finally {
    saving = false;
    $<HTMLButtonElement>("save").disabled = false;
  }
}
async function create(options?: {title:string; categoryId:string|null}) {
  if (!(await canLeave())) return;
  const previous = selected;
  let title = options?.title || "未命名文档",
    count = 2;
  while (!options && documents.some((d) => d.title === title))
    title = "未命名文档 " + count++;
  selected = undefined;
  renderEditor();
  $<HTMLButtonElement>("new").disabled = true;
  try {
    const destination = options ? options.categoryId : activeCategory;
    if (destination) collapsed.delete(destination);
    selected = await api.create({
      title,
      category: directoryCategories.find(c=>c.id===(options?.categoryId??activeCategory))?.name || "未分类",
      categoryId: options ? options.categoryId : activeCategory,
      body: "",
    });
    editing = true;
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
$("new").onclick = () => {const menu=$("new-menu");menu.hidden=!menu.hidden;$("new").setAttribute("aria-expanded",String(!menu.hidden));};
async function askName(title:string,initial="") {
 const answer=dialog(title,"请输入名称",[["cancel","取消"],["confirm","确认"]]);
 const input=document.createElement("input");input.id="directory-name";input.setAttribute("aria-label","名称");input.maxLength=200;input.value=initial;$("dialog-copy").append(input);input.focus();input.select();
 input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("dialog-actions").querySelector<HTMLButtonElement>('[data-choice="confirm"]')?.click();}};
 return (await answer)==="confirm"?input.value.trim():null;
}
async function namedDocument(categoryId:string|null=activeCategory){$("new-menu").hidden=true;$("new").setAttribute("aria-expanded","false");if(!(await canLeave()))return;const title=await askName("新建文档");if(title)await create({title,categoryId});}
$("new-document").onclick=()=>run(()=>namedDocument());
$("new-category").onclick=()=>run(async()=>{$("new-menu").hidden=true;$("new").setAttribute("aria-expanded","false");const name=await askName("新建分类");if(!name)return;const c=await api.createCategory(name);activeCategory=c.id;await refresh();$("documents").querySelector<HTMLElement>(`[data-category-id="${c.id}"]`)?.scrollIntoView({block:"nearest"});});
function startEditing() {
  if(!selected || trash.some(d=>d.id===selected!.id))return;
  editing=true;overlay.dataset.editing="true";rich.setEditable(true);$<HTMLInputElement>("title").readOnly=false;$("save").textContent="保存";$("save").title="Ctrl+S 保存（继续编辑）";rich.focus();
}
$("save").onclick = () => editing ? run(save) : startEditing();
$("folder").onclick = () => run(() => api.openFolder());
$("fullscreen").onclick = () => run(() => api.fullscreen());
$("search").oninput = () => {
  query = $<HTMLInputElement>("search").value.trim().toLocaleLowerCase();
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
$("documents").onclick = e => {
 const target=e.target as HTMLElement, group=target.closest<HTMLElement>("[data-category-id]"), action=target.closest<HTMLElement>("[data-category-action]")?.dataset.categoryAction;
 if(group){const id=group.dataset.categoryId||null;activeCategory=id;
  if(action==="add")run(()=>namedDocument(id));
  else if(action==="rename"&&id)run(async()=>{if(!(await canLeave()))return;const name=await askName("重命名分类",directoryCategories.find(c=>c.id===id)?.name);if(name){await api.renameCategory(id,name);await refresh();}});
  else if(action==="remove"&&id)run(async()=>{if(!(await canLeave()))return;if(await dialog("移除分类","分类中的文档将保留，并移到未分类。",[["cancel","取消"],["remove-category","移除分类"]])==="remove-category"){await api.removeCategory(id);await refresh();}});
  else if(id){if(!group.querySelector("[data-empty]")){collapsed.has(id)?collapsed.delete(id):collapsed.add(id);}localStorage.setItem("rhine-directory-collapsed",JSON.stringify([...collapsed]));renderList();}
  return;
 }
 const el=target.closest<HTMLElement>("[data-id]");if(el)run(()=>{const doc=documents.find(d=>d.id===el.dataset.id);if(doc?.categoryId)collapsed.delete(doc.categoryId);return select(el.dataset.id!);});
};

$("title").oninput = () => setDirty(true);
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
$("preview").onclick = (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a");
  if (!a) return;
  if(editing)return;
  e.preventDefault();
  const href = a.getAttribute("href") || "";
  if (/^https?:\/\//i.test(href)) run(() => api.openExternal(href));
  else notify("仅支持通过系统浏览器打开 http / https 外链。");
};
document.addEventListener("keydown", (e) => {
  if (!overlay.open || overlay.dataset.motionState === "closing") return;
  if ($<HTMLDialogElement>("dialog").open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    run(save);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    run(() => create());
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("search").focus();
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e" && !editing && !(e.target as HTMLElement).closest("input:not([readonly]),textarea,select,[contenteditable=true]")) {
    e.preventDefault(); startEditing();
  }
});

$("documents").ondragstart = (e) => {
  if (!(e.target as HTMLElement).closest(".document") || view === "trash") { e.preventDefault(); return; }
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
  dragged = el?.dataset.id || "";
  overlay.dataset.directoryDragging = "true";
  e.dataTransfer?.setData("text/plain", dragged);
};
$("documents").ondragend = () => {
  dragged = "";
  delete overlay.dataset.directoryDragging;
  overlay.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));
  renderList();
};
$("documents").ondragover = (e) => {
  if (view !== "trash") { e.preventDefault(); const group=(e.target as HTMLElement).closest<HTMLElement>("[data-drop-category]"); overlay.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));group?.classList.add("drop-target"); }
};
$("documents").ondrop = e => {
 e.preventDefault();overlay.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));
 const target=(e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id, group=(e.target as HTMLElement).closest<HTMLElement>("[data-drop-category]");
 if(!dragged||!group||view==="trash"||target===dragged)return;
 const movingId=dragged, categoryId=group.dataset.dropCategory||null;
 run(async()=>{if(!(await canLeave()))return;const moving=documents.find(d=>d.id===movingId);if(!moving)return;
  if((moving.categoryId??null)!==categoryId)await api.moveDocument(movingId,categoryId);
  if(target&&sort==="manual"){const current=await api.list();const ids=current.documents.map(d=>d.id);ids.splice(ids.indexOf(movingId),1);ids.splice(ids.indexOf(target),0,movingId);await api.reorder(ids);}
  if(categoryId)collapsed.delete(categoryId);await refresh();status("文档归类与顺序已保存");
 });
};



$("preferences").onclick = () => run(async () => {
  if (await closeLibrary()) window.dispatchEvent(new CustomEvent("rhine-open-settings"));
});
$("library-close").onclick = () => run(closeLibrary);
overlay.addEventListener("cancel", event => { event.preventDefault(); run(closeLibrary); });
async function closeLibrary() {
  if (!overlay.open) return true;
  if (!(await canLeave())) return false;
  directoryWheel.stop();
  if (!(await libraryMotion.hide())) return false;
  window.dispatchEvent(new CustomEvent("rhine-library-visibility", {detail:false}));
  window.dispatchEvent(new CustomEvent("rhine-library-selected", {detail:selected?.id}));
  opener?.focus({preventScroll:true});
  return true;
}
export async function openLibrary(id?: string, requestedView: "all" | "saved" | "trash" = "all") {
  if (overlay.dataset.motionState === "closing") void libraryMotion.show();
  return run(async () => {
    if (overlay.open && !(await canLeave())) return;
    if (!overlay.open) opener = document.activeElement as HTMLElement;
    saved.clear();
    const stored = read("rhine-saved", []);
    if (Array.isArray(stored)) stored.filter(value => typeof value === "string").forEach(value => saved.add(value));
    view = requestedView; query = ""; filter = "";
    $("notice").classList.remove("visible");
    $<HTMLInputElement>("search").value = "";
    $<HTMLSelectElement>("sort").value = sort;
    await refresh();
    if (id) {const c=documents.find(d=>d.id===id)?.categoryId;if(c)collapsed.delete(c);await select(id);}
    else { selected = undefined; renderEditor(); }
    updateNav(); renderList();
    if (!overlay.open) void libraryMotion.show();
    window.dispatchEvent(new CustomEvent("rhine-library-visibility", {detail:true}));
    $(id ? "save" : "search").focus();
  });
}
let timer: ReturnType<typeof setTimeout>;
api.onChanged(() => {
  if (!overlay.open) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(refresh), 220);
});

async function requestEditorInput(kind: "link"|"math"|"table", initial: Record<string,string> = {}) {
  const answer=dialog(kind==="link"?"插入链接":kind==="math"?"LaTeX 公式":"插入表格",kind==="link"?"输入 HTTP / HTTPS 链接；清空地址可移除链接。":kind==="math"?"输入 LaTeX，确认后正文显示公式。":"选择表格行列数。",[["cancel","取消"],["confirm","确认"]]);
  const form=document.createElement("div");form.className="editor-inputs";
  form.innerHTML=kind==="table"?'<label>行数<input id="editor-rows" type="number" min="1" max="20" value="3"/></label><label>列数<input id="editor-cols" type="number" min="1" max="10" value="3"/></label>':kind==="math"?'<textarea id="editor-value" aria-label="LaTeX 公式" rows="3"></textarea><label>显示方式<select id="editor-display"><option value="inline">行内公式</option><option value="block">独立公式</option></select></label>':'<label>链接地址<input id="editor-value" type="url" placeholder="https://"/></label><label>链接文字<input id="editor-label"/></label>';
  $("dialog-copy").after(form);
  for(const [key,value] of Object.entries(initial)){const input=form.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>("#editor-"+key);if(input)input.value=value;}
  form.querySelector<HTMLInputElement|HTMLTextAreaElement>("input,textarea")?.focus();
  const choice=await answer;
  const result:Record<string,string>={};form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>("input,textarea,select").forEach(input=>result[input.id.replace("editor-","")]=input.value.trim());form.remove();
  if(choice!=="confirm")return null;
  if(kind==="link" && result.value && !/^https?:\/\//i.test(result.value)){notify("请输入 HTTP / HTTPS 链接。");return null;}
  if(kind==="math" && !result.value)return null;
  if(kind==="table" && (!Number.isInteger(+result.rows)||+result.rows<1||+result.rows>20||!Number.isInteger(+result.cols)||+result.cols<1||+result.cols>10)){notify("表格支持 1–20 行、1–10 列。");return null;}
  return result;
}
