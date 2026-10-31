import {
  createRelationshipIndex, documentRelations, localDocumentGraph,
  type GraphDocument, type RelatedDocument, type RelationshipIndex,
} from "./desktop-graph-data";
import { archiveIdentity } from "./archive-identity";
import "./desktop-relations.css";

type Hooks = {
  documents: () => readonly GraphDocument[];
  navigate: (id: string) => void | Promise<void>;
  expandGraph: (id: string, depth: 1 | 2) => void;
  changed?: (open: boolean) => void;
};
const NS = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
};

/** Saved document links are facts; this view stores no parallel relationship data. */
export function mountDocumentRelations(host: HTMLElement, hooks: Hooks) {
  host.classList.add("document-relations"); host.hidden = true;
  host.setAttribute("aria-label", "当前文档关系");
  host.innerHTML = '<header class="relations-heading"><div><span class="relations-identity"></span><strong class="relations-title"></strong></div><button type="button" class="relations-close" aria-label="收起文档关系">×</button></header><div class="relations-body"><section class="relations-list"><div class="relations-tools"><div role="group" aria-label="关系类型"><button type="button" data-relations-tab="incoming" aria-pressed="true">引用来源</button><button type="button" data-relations-tab="outgoing" aria-pressed="false">引用去向</button><button type="button" data-relations-tab="mentions" aria-pressed="false">未链接提及</button></div><input id="relations-filter" type="search" aria-label="筛选文档关系" placeholder="筛选标题、编号与引用内容"></div><div class="relations-results" role="list"></div></section><section class="relations-map"><div class="relations-map-tools"><label>局部关系<select id="relations-depth" aria-label="关系预览层数"><option value="1">一层</option><option value="2">两层</option></select></label><button type="button" id="relations-expand">放大图谱 ↗</button></div><svg id="relations-preview" viewBox="0 0 300 180" role="group" aria-label="当前文档的局部图谱"></svg><span class="relations-map-count"></span></section></div>';
  const $ = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
  const filter = $<HTMLInputElement>("#relations-filter"), results = $(".relations-results");
  let current: string | undefined, tab: "incoming" | "outgoing" | "mentions" = "incoming", depth: 1 | 2 = 1;
  let index: RelationshipIndex | undefined;
  let snapshot: GraphDocument[] = [];
  function data() {
    const documents = hooks.documents();
    if (!index || snapshot.length !== documents.length || documents.some((doc, i) => {
      const saved = snapshot[i]; return !saved || saved.id !== doc.id || saved.title !== doc.title || saved.body !== doc.body || saved.category !== doc.category;
    })) {
      snapshot = documents.map(doc => ({ ...doc }));
      index = createRelationshipIndex(documents);
    }
    return index;
  }
  function close() { host.hidden = true; hooks.changed?.(false); }
  async function navigate(id: string) {
    if (!hooks.documents().some(doc => doc.id === id)) { render(); return; }
    await hooks.navigate(id);
  }
  function item(entry: RelatedDocument) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "relation-document"; button.dataset.relationId = entry.document.id;
    button.setAttribute("role", "listitem");
    const identity = archiveIdentity(entry.document);
    const title = document.createElement("strong"); title.textContent = entry.document.title;
    const detail = document.createElement("span"); detail.className = "relation-identity";
    detail.textContent = `${identity.mark} ${identity.code} / ${identity.category} / ${entry.count} 处`;
    button.append(title, detail);
    for (const context of entry.contexts) { const excerpt = document.createElement("p"); excerpt.textContent = context; button.append(excerpt); }
    button.onclick = () => void navigate(entry.document.id);
    return button;
  }
  function map(index: RelationshipIndex) {
    const graph = localDocumentGraph(index.graph, current!, depth), canvas = $<SVGSVGElement>("#relations-preview");
    canvas.replaceChildren();
    // This compact orientation view has bounded marks. The full view includes all neighbours.
    const focus = graph.nodes.find(node => node.id === current);
    if (!focus) return;
    const visible = [focus, ...graph.nodes.filter(node => node.id !== current).slice(0, 35)];
    const positions = new Map(visible.map((node, i) => {
      const angle = (i - 1) * Math.PI * 2 / Math.max(1, visible.length - 1) - Math.PI / 2;
      return [node.id, { x: i ? 150 + Math.cos(angle) * 105 : 150, y: i ? 85 + Math.sin(angle) * 56 : 85 }];
    }));
    for (const edge of graph.edges) {
      const a = positions.get(edge.source), b = positions.get(edge.target);
      if (a && b) canvas.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    }
    for (const node of visible) {
      const point = positions.get(node.id)!, group = svg("g", { transform: `translate(${point.x} ${point.y})`, role: "button", tabindex: "0", "aria-label": node.title, "data-local-id": node.id });
      group.classList.toggle("relations-center", node.id === current);
      const hit = svg("circle", { r: 16, class: "relations-hit" }), dot = svg("circle", { r: node.id === current ? 7 : 4 });
      const title = svg("title"); title.textContent = `${node.title} / ${archiveIdentity(node).code}`;
      group.append(hit, dot, title);
      if (visible.length <= 8 || node.id === current) {
        const label = svg("text", { "text-anchor": "middle", y: node.id === current ? 24 : -13 });
        label.textContent = node.title.length > 12 ? node.title.slice(0, 11) + "…" : node.title;
        group.append(label);
      }
      group.addEventListener("click", () => void navigate(node.id));
      group.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void navigate(node.id); } });
      canvas.append(group);
    }
    $(".relations-map-count").textContent = `${graph.nodes.length} 篇文档 / ${graph.edges.length} 条关系${graph.nodes.length > visible.length ? ` / 预览 ${visible.length} 篇` : ""}`;
  }
  function render() {
    if (host.hidden) return;
    const index = data(), note = index.graph.nodes.find(doc => doc.id === current);
    if (!note) { close(); return; }
    const identity = archiveIdentity(note), relations = documentRelations(index, current!);
    $(".relations-title").textContent = note.title;
    $(".relations-identity").textContent = `${identity.mark} ${identity.code}`;
    const names = { incoming: "引用来源", outgoing: "引用去向", mentions: "未链接提及" };
    host.querySelectorAll<HTMLButtonElement>("[data-relations-tab]").forEach(button => {
      const kind = button.dataset.relationsTab as typeof tab;
      button.textContent = `${names[kind]} ${relations[kind].length}`;
      button.setAttribute("aria-pressed", String(kind === tab));
    });
    const query = filter.value.trim().toLocaleLowerCase();
    const matches = relations[tab].filter(entry => `${entry.document.title}\n${entry.document.id}\n${entry.document.category || ""}\n${entry.contexts.join("\n")}`.toLocaleLowerCase().includes(query));
    results.replaceChildren(...matches.map(item)); results.setAttribute("data-relation-kind", tab);
    if (!matches.length) { const empty = document.createElement("p"); empty.className = "relations-empty"; empty.textContent = query ? "没有匹配的关系" : tab === "mentions" ? "没有未链接的标题提及" : tab === "incoming" ? "尚无其他文档引用这里" : "正文尚未链接其他文档"; results.append(empty); }
    map(index);
  }
  function update(id?: string) { if (current !== id) filter.value = ""; current = id; render(); }
  function open(id = current) { current = id; if (!id || !hooks.documents().some(doc => doc.id === id)) return; host.hidden = false; hooks.changed?.(true); render(); }
  host.querySelectorAll<HTMLButtonElement>("[data-relations-tab]").forEach(button => { button.onclick = () => { tab = button.dataset.relationsTab as typeof tab; render(); }; });
  $(".relations-close").addEventListener("click", close);
  filter.addEventListener("input", render);
  $<HTMLSelectElement>("#relations-depth").addEventListener("change", event => { depth = (event.target as HTMLSelectElement).value === "2" ? 2 : 1; render(); });
  $("#relations-expand").addEventListener("click", () => { if (current) hooks.expandGraph(current, depth); });
  return { update, open, close, toggle(id = current) { if (!host.hidden) close(); else open(id); }, isOpen: () => !host.hidden };
}
