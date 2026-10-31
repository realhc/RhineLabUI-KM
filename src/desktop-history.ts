import { renderMarkdown } from "./desktop-markdown";
import { hydrateDocumentImages } from "./document-images";
import { archiveIdentity } from "./archive-identity";
import { compareHistory } from "./desktop-history-diff";
import "./desktop-history.css";

type Hooks = {
  host: HTMLElement;
  getDocument: () => RhineDocument | undefined;
  canLeave: () => Promise<boolean>;
  onRestored: (document: RhineDocument, copied: boolean) => void | Promise<void>;
  onError: (error: unknown) => void;
};

/** History is read only until an explicit restore/copy action passes the draft guard. */
export function mountDocumentHistory(hooks: Hooks) {
  const panel = document.createElement("dialog");
  panel.id = "document-history";
  panel.setAttribute("aria-labelledby", "history-title");
  panel.innerHTML = '<header class="history-header"><div><div class="history-kicker">ARCHIVE HISTORY</div><h2 id="history-title">文档历史</h2><p id="history-document"></p></div><button id="history-close" type="button" aria-label="关闭文档历史">CLOSE ×</button></header><div class="history-body"><nav class="history-timeline" aria-label="已保存修订"><div id="history-list"></div></nav><section class="history-detail"><div class="history-tools"><button id="history-preview-mode" type="button" aria-pressed="true">正文预览</button><button id="history-diff-mode" type="button" aria-pressed="false">与当前比较</button><span id="history-date"></span></div><div id="history-status" role="status" aria-live="polite"></div><article id="history-preview"></article><div id="history-diff" hidden></div><footer class="history-actions"><span>恢复前保留当前版本</span><button id="history-copy" type="button" disabled>另存副本</button><button id="history-restore" type="button" class="solid" disabled>恢复此版本</button></footer></section></div>';
  hooks.host.append(panel);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  let opener: HTMLElement | null = null;
  let activeId = "", selectedKey = "", generation = 0, busy = false, disposed = false;
  let entries: RhineHistoryEntry[] = [], snapshot: RhineDocument | undefined, current: RhineDocument | undefined;
  let mode: "preview" | "diff" = "preview";
  function status(message: string) { $("history-status").textContent = message; }
  function buttons() {
    for (const id of ["history-copy", "history-restore"]) $<HTMLButtonElement>(id).disabled = busy || !snapshot;
    panel.setAttribute("aria-busy", String(busy));
  }
  function clearDetail() {
    snapshot = undefined; $("history-preview").replaceChildren(); $("history-diff").replaceChildren(); $("history-date").textContent = ""; buttons();
  }
  function showMode() {
    $("history-preview").hidden = mode !== "preview";
    $("history-diff").hidden = mode !== "diff";
    $("history-preview-mode").setAttribute("aria-pressed", String(mode === "preview"));
    $("history-diff-mode").setAttribute("aria-pressed", String(mode === "diff"));
  }
  function drawDifference() {
    const area = $("history-diff"); area.replaceChildren();
    if (!snapshot || !current) return;
    const meta = document.createElement("p"); meta.className = "history-diff-legend"; meta.textContent = "− 当前版本    ＋ 所选历史版本"; area.append(meta);
    if (snapshot.title !== current.title) {
      for (const [kind, title] of [["removed", current.title], ["added", snapshot.title]]) { const row = document.createElement("div"); row.className = `history-diff-line ${kind}`; row.textContent = `${kind === "added" ? "+" : "−"} 标题：${title}`; area.append(row); }
    }
    const comparison = compareHistory(current.body, snapshot.body);
    const difference = comparison.lines;
    if (!difference.some(row => row.kind !== "same") && current.title === snapshot.title) { const same = document.createElement("p"); same.textContent = "正文与标题相同"; area.append(same); return; }
    const fragment = document.createDocumentFragment();
    for (const row of difference.slice(0, 3000)) {
      const line = document.createElement("div"); line.className = `history-diff-line ${row.kind}`;
      const mark = document.createElement("span"); mark.setAttribute("aria-hidden", "true"); mark.textContent = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " ";
      const text = document.createElement("span"); text.textContent = row.text || " "; line.append(mark, text); fragment.append(line);
    }
    area.append(fragment);
    if (comparison.truncated) { const more = document.createElement("p"); more.textContent = "差异较长，部分行或行内文字已省略。可另存副本查看完整内容。"; area.append(more); }
  }
  async function select(key: string) {
    if (busy || !panel.open) return;
    const ticket = ++generation, id = activeId;
    selectedKey = key; clearDetail(); status("正在读取历史…");
    $("history-list").querySelectorAll<HTMLElement>("[data-history-key]").forEach(item => item.setAttribute("aria-current", String(item.dataset.historyKey === key)));
    try {
      const loaded = await window.rhine.readHistory(id, key);
      if (disposed || ticket !== generation || !panel.open || id !== activeId) return;
      snapshot = loaded;
      const entry = entries.find(item => item.key === key);
      $("history-date").textContent = entry ? new Date(entry.savedAt).toLocaleString() : "";
      $("history-preview").innerHTML = renderMarkdown(loaded.body);
      hydrateDocumentImages($("history-preview"), id);
      drawDifference(); status(""); buttons();
    } catch (error) { if (ticket === generation && panel.open) { status(error instanceof Error ? error.message : String(error)); buttons(); } }
  }
  async function load() {
    const target = hooks.getDocument();
    const ticket = ++generation;
    if (!target) { activeId = ""; selectedKey = ""; clearDetail(); $("history-list").replaceChildren(); status("请先选择一篇文档。"); return; }
    const changed = activeId !== target.id;
    activeId = target.id; current = target;
    if (changed) selectedKey = "";
    const identity = archiveIdentity(target);
    $("history-document").textContent = `${identity.mark} ${identity.code} / ${target.title}`;
    clearDetail(); status("正在读取历史…");
    try {
      const loadedEntries = await window.rhine.listHistory(target.id);
      if (disposed || ticket !== generation || !panel.open || target.id !== activeId) return;
      entries = loadedEntries;
      const list = $("history-list"); list.replaceChildren();
      for (const entry of entries) {
        const button = document.createElement("button"); button.type = "button"; button.dataset.historyKey = entry.key;
        const date = document.createElement("strong"); date.textContent = new Date(entry.savedAt).toLocaleString();
        const title = document.createElement("span"); title.textContent = entry.title;
        const size = document.createElement("small"); size.textContent = `${Math.max(1, Math.round(entry.bytes / 1024))} KB`;
        button.append(date, title, size); button.onclick = () => void select(entry.key); list.append(button);
      }
      if (!entries.length) { selectedKey = ""; status("尚无已保存的历史。修改并保存后，这里会保留之前的版本。"); return; }
      await select(entries.some(entry => entry.key === selectedKey) ? selectedKey : entries[0].key);
    } catch (error) { if (ticket === generation && panel.open) status(error instanceof Error ? error.message : String(error)); }
  }
  function close() { if (busy) return; generation++; panel.close(); clearDetail(); entries = []; current = undefined; $("history-list").replaceChildren(); opener?.focus({ preventScroll: true }); }
  async function write(copy: boolean) {
    if (busy || !snapshot || !activeId || !selectedKey) return;
    busy = true; buttons();
    const id = activeId, key = selectedKey;
    try {
      if (!(await hooks.canLeave())) return;
      const latest = hooks.getDocument();
      if (!latest || latest.id !== id || !panel.open) throw Error("当前文档已改变，请重新打开历史。");
      // Re-read the immutable selection after draft resolution and before writes.
      const version = await window.rhine.readHistory(id, key);
      let result: RhineDocument;
      if (copy) {
        const all = await window.rhine.list();
        const base = version.title.slice(0, 450) + "（历史副本）";
        let title = base, suffix = 2;
        while (all.documents.some(doc => doc.title.normalize("NFC").toLocaleLowerCase() === title.normalize("NFC").toLocaleLowerCase())) title = base + " " + suffix++;
        result = await window.rhine.create({ title, body: version.body, category: latest.category, categoryId: latest.categoryId ?? null });
      } else result = await window.rhine.restoreHistory(id, key, latest.revision);
      await hooks.onRestored(result, copy);
      busy = false; close();
    } catch (error) { status(error instanceof Error ? error.message : String(error)); hooks.onError(error); }
    finally { busy = false; buttons(); }
  }
  $("history-close").onclick = close;
  panel.addEventListener("cancel", event => { event.preventDefault(); close(); });
  $("history-preview-mode").onclick = () => { mode = "preview"; showMode(); };
  $("history-diff-mode").onclick = () => { mode = "diff"; showMode(); };
  $("history-copy").onclick = () => void write(true);
  $("history-restore").onclick = () => void write(false);
  $("history-preview").onclick = event => {
    const link = (event.target as HTMLElement).closest("a"); if (!link) return;
    event.preventDefault(); const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) void window.rhine.openExternal(href).catch(hooks.onError);
  };
  return {
    async open() { if (disposed) return; if (!panel.open) { opener = document.activeElement as HTMLElement; panel.showModal(); } showMode(); await load(); },
    close, isOpen: () => panel.open,
    async refresh() { if (panel.open && !busy) await load(); },
    dispose() { disposed = true; generation++; panel.remove(); },
  };
}
