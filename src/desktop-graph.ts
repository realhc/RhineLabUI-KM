import { buildDocumentGraph, localDocumentGraph } from "./desktop-graph-data";
import { archiveIdentity } from "./archive-identity";
import "./desktop-graph.css";

type GraphNode = { id: string; title: string; category?: string };
type GraphEdge = { source: string; target: string };
type Point = GraphNode & { x: number; y: number; vx: number; vy: number; degree: number };
type Link = { source: Point; target: Point; element: SVGLineElement };
type Hooks = {
  documents: () => RhineDocument[];
  openDocument: (id: string) => Promise<boolean>;
};

const NS = "http://www.w3.org/2000/svg";
const makeSVG = <K extends keyof SVGElementTagNameMap>(tag: K) => document.createElementNS(NS, tag);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** The graph is a read-only view of document links. It never writes a document. */
export function mountGraphWorkspace(overlay: HTMLDialogElement, hooks: Hooks) {
  const panel = document.createElement("dialog");
  panel.id = "graph-workspace";
  panel.setAttribute("aria-labelledby", "graph-title");
  panel.innerHTML = `<header class="graph-header"><div><div class="graph-kicker">ARCHIVE DIRECTORY</div><h2 id="graph-title">关系图谱</h2></div><button id="graph-close" type="button" aria-label="关闭关系图谱">CLOSE ×</button></header>
    <div class="graph-tools"><input id="graph-search" type="search" placeholder="搜索文档" aria-label="搜索图谱中的文档" autocomplete="off"><label class="graph-orphans-label"><input id="graph-orphans" type="checkbox" checked>显示孤点</label><label class="graph-depth-label" hidden>关系范围<select id="graph-depth" aria-label="局部图谱关系层数"><option value="1">一层</option><option value="2">两层</option></select></label><button id="graph-global" type="button" hidden>查看全局</button><button id="graph-fit" type="button" title="调整视野以显示全部节点">适应画面</button><span id="graph-count" role="status" aria-live="polite"></span></div>
    <div class="graph-stage"><svg id="graph-canvas" role="group" aria-label="文档关系图谱"><defs><pattern id="graph-grid-minor" patternUnits="userSpaceOnUse" width="32" height="32"><path d="M32 .5H.5V32"/></pattern><pattern id="graph-grid-major" patternUnits="userSpaceOnUse" width="160" height="160"><path d="M160 .5H.5V160"/></pattern></defs><g class="graph-grid" aria-hidden="true"><rect class="graph-grid-minor" width="100%" height="100%" fill="url(#graph-grid-minor)"/><rect class="graph-grid-major" width="100%" height="100%" fill="url(#graph-grid-major)"/></g><g class="graph-transform"><g class="graph-edges"></g><g class="graph-nodes"></g></g></svg><div id="graph-empty" class="graph-empty" hidden></div></div>`;
  overlay.append(panel);
  const $ = <T extends Element>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const search = $<HTMLInputElement>("graph-search");
  const orphans = $<HTMLInputElement>("graph-orphans");
  const canvas = $<SVGSVGElement>("graph-canvas");
  const transform = panel.querySelector<SVGGElement>(".graph-transform")!;
  const grid = [
    { pattern: $<SVGPatternElement>("graph-grid-minor"), surface: panel.querySelector<SVGRectElement>(".graph-grid-minor")!, unit: 32 },
    { pattern: $<SVGPatternElement>("graph-grid-major"), surface: panel.querySelector<SVGRectElement>(".graph-grid-major")!, unit: 160 },
  ];
  const edgeLayer = panel.querySelector<SVGGElement>(".graph-edges")!;
  const nodeLayer = panel.querySelector<SVGGElement>(".graph-nodes")!;
  const empty = $<HTMLElement>("graph-empty");
  const count = $<HTMLElement>("graph-count");
  const depthControl = $<HTMLSelectElement>("graph-depth");
  let localCenter: string | undefined, localDepth: 1 | 2 = 1;
  let nodes: Point[] = [], links: Link[] = [], points = new Map<string, Point>();
  let groups = new Map<string, SVGGElement>();
  let edgesByNode = new Map<string, Link[]>();
  let sourceNodes: GraphNode[] = [], sourceEdges: GraphEdge[] = [];
  let scale = 1, tx = 0, ty = 0;
  let gridScale = Number.NaN;
  let hovered = "", suppressClick = false, selecting = false;
  let opener: HTMLElement | null = null;
  let drag: { id: number; node?: Point; startX: number; startY: number; lastX: number; lastY: number; moved: boolean; capture: Element } | undefined;

  function applyTransform() {
    transform.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
    // Paint only two SVG tiles, with fixed one-pixel strokes at every zoom level.
    // The phase follows world origin without a large off-screen grid geometry.
    for (const { pattern, surface, unit } of grid) {
      const spacing = unit * scale;
      pattern.setAttribute("x", String(((tx % spacing) + spacing) % spacing));
      pattern.setAttribute("y", String(((ty % spacing) + spacing) % spacing));
      if (gridScale !== scale) {
        pattern.setAttribute("width", String(spacing));
        pattern.setAttribute("height", String(spacing));
        pattern.firstElementChild!.setAttribute("d", `M${spacing} .5H.5V${spacing}`);
        surface.style.opacity = String(clamp((spacing - 14) / (unit === 32 ? 14 : 22), 0, 1));
      }
    }
    gridScale = scale;
  }
  function updateLink(link: Link) {
    link.element.setAttribute("x1", String(link.source.x));
    link.element.setAttribute("y1", String(link.source.y));
    link.element.setAttribute("x2", String(link.target.x));
    link.element.setAttribute("y2", String(link.target.y));
  }
  function updatePoint(point: Point) {
    groups.get(point.id)?.setAttribute("transform", `translate(${point.x} ${point.y})`);
  }
  function drawPositions() {
    for (const point of nodes) updatePoint(point);
    for (const link of links) updateLink(link);
  }
  // Bounded force passes settle before interaction, keeping hit targets stable.
  function layoutStep() {
    const n = nodes.length;
    const stride = Math.max(1, Math.ceil(n / 90));
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j += stride) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let distance2 = dx * dx + dy * dy;
        if (distance2 < 1) { dx = (i % 2 ? 1 : -1) * 2; dy = (j % 2 ? 1 : -1) * 2; distance2 = 8; }
        const strength = Math.min(1.5, 1800 / distance2) / Math.sqrt(distance2);
        a.vx += dx * strength; a.vy += dy * strength;
        b.vx -= dx * strength; b.vy -= dy * strength;
      }
      a.vx -= a.x * 0.0007; a.vy -= a.y * 0.0007;
    }
    for (const { source, target } of links) {
      const dx = target.x - source.x, dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = clamp((distance - 105) * 0.002, -0.28, 0.28);
      source.vx += dx / distance * force; source.vy += dy / distance * force;
      target.vx -= dx / distance * force; target.vy -= dy / distance * force;
    }
    for (const p of nodes) {
      if (localCenter === p.id) { p.x = p.y = p.vx = p.vy = 0; continue; }
      if (drag?.node === p) { p.vx = p.vy = 0; continue; }
      p.vx = clamp(p.vx * 0.72, -8, 8); p.vy = clamp(p.vy * 0.72, -8, 8);
      p.x += p.vx; p.y += p.vy;
    }
  }
  function startLayout() {
    const passes = nodes.length > 1000 ? 12 : nodes.length > 400 ? 25 : 54;
    if (nodes.length > 1) for (let i = 0; i < passes; i++) layoutStep();
    drawPositions();
    fit();
  }
  function fit() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!nodes.length) { scale = 1; tx = rect.width / 2; ty = rect.height / 2; applyTransform(); return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of nodes) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const center = localCenter ? points.get(localCenter) : undefined;
    const width = Math.max(1, center ? 2 * Math.max(Math.abs(minX - center.x), Math.abs(maxX - center.x)) + 180 : maxX - minX + 180);
    const height = Math.max(1, center ? 2 * Math.max(Math.abs(minY - center.y), Math.abs(maxY - center.y)) + 120 : maxY - minY + 120);
    scale = clamp(Math.min(rect.width / width, rect.height / height), .12, 1.5);
    tx = rect.width / 2 - (center ? center.x : (minX + maxX) / 2) * scale;
    ty = rect.height / 2 - (center ? center.y : (minY + maxY) / 2) * scale;
    applyTransform();
  }
  function setHighlight() {
    const query = search.value.trim().toLocaleLowerCase();
    const matching = new Set<string>();
    if (query) for (const node of nodes)
      if (`${node.title}\n${node.category || ""}\n${node.id}`.toLocaleLowerCase().includes(query)) matching.add(node.id);
    const relevant = new Set(matching);
    if (query) for (const link of links) {
      if (matching.has(link.source.id)) relevant.add(link.target.id);
      if (matching.has(link.target.id)) relevant.add(link.source.id);
    }
    const neighbors = new Set([hovered]);
    if (hovered) for (const link of edgesByNode.get(hovered) || []) {
      neighbors.add(link.source.id); neighbors.add(link.target.id);
    }
    for (const [id, group] of groups) {
      group.classList.toggle("graph-muted", (!!query && !relevant.has(id)) || (!!hovered && !neighbors.has(id)));
      group.classList.toggle("graph-match", !!query && matching.has(id));
      group.classList.toggle("graph-focus", id === hovered);
      group.classList.toggle("graph-center", id === localCenter);
    }
    for (const link of links) {
      link.element.classList.toggle("graph-muted", (!!query && !matching.has(link.source.id) && !matching.has(link.target.id)) || (!!hovered && link.source.id !== hovered && link.target.id !== hovered));
      link.element.classList.toggle("graph-focus", !!hovered && (link.source.id === hovered || link.target.id === hovered));
    }
    count.textContent = query ? `${matching.size} 个匹配` : `${nodes.length} 篇文档  ${links.length} 条关系`;
    empty.hidden = nodes.length > 0 && (!query || matching.size > 0);
    empty.textContent = !nodes.length ? (localCenter ? "当前文档已不在知识库中" : sourceNodes.length ? "没有关联的文档" : "还没有文档") : "没有匹配的文档";
  }
  function render() {
    const old = points;
    const degrees = new Map(sourceNodes.map(node => [node.id, 0]));
    for (const edge of sourceEdges) {
      if (!degrees.has(edge.source) || !degrees.has(edge.target)) continue;
      degrees.set(edge.source, degrees.get(edge.source)! + 1);
      degrees.set(edge.target, degrees.get(edge.target)! + 1);
    }
    const visible = sourceNodes.filter(node => node.id === localCenter || orphans.checked || (degrees.get(node.id) || 0) > 0);
    nodes = visible.map((node, i) => {
      const previous = old.get(node.id), angle = i * Math.PI * (3 - Math.sqrt(5)), radius = 32 * Math.sqrt(i);
      return { ...node, x: previous?.x ?? Math.cos(angle) * radius, y: previous?.y ?? Math.sin(angle) * radius, vx: 0, vy: 0, degree: degrees.get(node.id) || 0 };
    });
    points = new Map(nodes.map(node => [node.id, node]));
    groups = new Map(); edgesByNode = new Map(); links = [];
    edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
    const edgeFragment = document.createDocumentFragment(), nodeFragment = document.createDocumentFragment();
    for (const edge of sourceEdges) {
      const source = points.get(edge.source), target = points.get(edge.target);
      if (!source || !target) continue;
      const element = makeSVG("line");
      element.setAttribute("data-graph-edge", `${source.id}:${target.id}`);
      const link = { source, target, element };
      links.push(link);
      for (const id of [source.id, target.id]) {
        const items = edgesByNode.get(id) || []; items.push(link); edgesByNode.set(id, items);
      }
      edgeFragment.append(element);
    }
    for (const point of nodes) {
      const group = makeSVG("g"), hit = makeSVG("circle"), circle = makeSVG("circle"), label = makeSVG("text"), identityLabel = makeSVG("text"), tooltip = makeSVG("title");
      const identity = archiveIdentity(point);
      group.classList.add("graph-node");
      group.setAttribute("data-graph-id", point.id);
      group.setAttribute("role", "button"); group.setAttribute("tabindex", "0");
      group.setAttribute("aria-label", `${point.title}，${point.degree} 条关系`);
      hit.classList.add("graph-hit"); hit.setAttribute("r", "26");
      circle.setAttribute("r", String(clamp(5.5 + Math.sqrt(point.degree) * 1.5, 6, 15)));
      label.setAttribute("y", "-14"); label.setAttribute("text-anchor", "middle");
      label.textContent = point.title.length > 26 ? point.title.slice(0, 25) + "…" : point.title;
      identityLabel.classList.add("graph-identity");
      identityLabel.setAttribute("y", "28"); identityLabel.setAttribute("text-anchor", "middle");
      identityLabel.textContent = `${identity.mark} ${identity.code}`;
      tooltip.textContent = `${point.title} / ${identity.category} / ${point.id}`;
      group.append(hit, circle, label, identityLabel, tooltip); groups.set(point.id, group); nodeFragment.append(group);
    }
    nodeLayer.classList.toggle("graph-dense", nodes.length > 180);
    edgeLayer.append(edgeFragment); nodeLayer.append(nodeFragment);
    startLayout(); setHighlight();
  }
  function refresh() {
    if (!panel.open) return;
    const all = buildDocumentGraph(hooks.documents());
    const graph = localCenter ? localDocumentGraph(all, localCenter, localDepth) : all;
    const current = all.nodes.find(node => node.id === localCenter);
    panel.dataset.graphMode = localCenter ? "local" : "global";
    $("graph-title").textContent = localCenter ? (current ? `局部关系 / ${current.title}` : "局部关系") : "关系图谱";
    panel.querySelector<HTMLElement>(".graph-depth-label")!.hidden = !localCenter;
    $("graph-global").toggleAttribute("hidden", !localCenter);
    panel.querySelector<HTMLElement>(".graph-orphans-label")!.hidden = !!localCenter;
    depthControl.value = String(localDepth);
    sourceNodes = graph.nodes; sourceEdges = graph.edges;
    hovered = "";
    render();
  }
  function close() {
    if (!panel.open) return;
    drag = undefined;
    panel.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  function show() {
    if (panel.open) { refresh(); return; }
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search.value = "";
    panel.showModal();
    refresh();
    search.focus({ preventScroll: true });
  }
  function open() { localCenter = undefined; show(); }
  function openLocal(id: string, depth: 1 | 2 = 1) { localCenter = id; localDepth = depth === 2 ? 2 : 1; points.clear(); show(); }
  async function choose(id: string) {
    if (selecting || !points.has(id)) return;
    selecting = true;
    try { if (await hooks.openDocument(id)) close(); }
    finally { selecting = false; }
  }
  function graphElement(event: Event) {
    return event.target instanceof Element ? event.target.closest<SVGGElement>("[data-graph-id]") : null;
  }
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const group = graphElement(event), point = group && points.get(group.dataset.graphId || "");
    const capture = group || canvas;
    drag = { id: event.pointerId, node: point || undefined, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, capture };
    capture.setPointerCapture(event.pointerId);
    if (!point) canvas.classList.add("graph-panning");
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    drag.lastX = event.clientX; drag.lastY = event.clientY;
    if (drag.node) {
      drag.node.x += dx / scale; drag.node.y += dy / scale; drag.node.vx = drag.node.vy = 0;
      updatePoint(drag.node);
      for (const link of edgesByNode.get(drag.node.id) || []) updateLink(link);
    } else { tx += dx; ty += dy; applyTransform(); }
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick = drag.moved;
    if (drag.capture.hasPointerCapture(event.pointerId)) drag.capture.releasePointerCapture(event.pointerId);
    drag = undefined; canvas.classList.remove("graph-panning");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("click", event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const id = graphElement(event)?.dataset.graphId;
    if (id) void choose(id);
  });
  canvas.addEventListener("pointerover", event => {
    const id = graphElement(event)?.dataset.graphId || "";
    if (id && id !== hovered) { hovered = id; setHighlight(); }
  });
  canvas.addEventListener("pointerout", event => {
    const from = graphElement(event), to = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-graph-id]") : null;
    if (from && from !== to) { hovered = ""; setHighlight(); }
  });
  canvas.addEventListener("focusin", event => { hovered = graphElement(event)?.dataset.graphId || ""; setHighlight(); });
  canvas.addEventListener("focusout", () => { hovered = ""; setHighlight(); });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const next = clamp(scale * Math.exp(-event.deltaY * .0015), .12, 4);
    tx = x - (x - tx) * next / scale; ty = y - (y - ty) * next / scale; scale = next;
    applyTransform();
  }, { passive: false });
  panel.addEventListener("keydown", event => {
    event.stopPropagation();
    const id = graphElement(event)?.dataset.graphId;
    if (id && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void choose(id); }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); scale = clamp(scale * 1.2, .12, 4); applyTransform(); }
    if (event.key === "-" || event.key === "_") { event.preventDefault(); scale = clamp(scale / 1.2, .12, 4); applyTransform(); }
    const step = event.shiftKey ? 70 : 24;
    if (event.key === "ArrowLeft") { event.preventDefault(); tx += step; applyTransform(); }
    if (event.key === "ArrowRight") { event.preventDefault(); tx -= step; applyTransform(); }
    if (event.key === "ArrowUp") { event.preventDefault(); ty += step; applyTransform(); }
    if (event.key === "ArrowDown") { event.preventDefault(); ty -= step; applyTransform(); }
  });
  panel.addEventListener("cancel", event => { event.preventDefault(); event.stopPropagation(); close(); });
  search.addEventListener("input", setHighlight);
  orphans.addEventListener("change", render);
  $("graph-fit").addEventListener("click", fit);
  $("graph-close").addEventListener("click", close);
  $("graph-global").addEventListener("click", open);
  depthControl.addEventListener("change", () => { localDepth = depthControl.value === "2" ? 2 : 1; refresh(); });
  return { open, openLocal, close, refresh, isOpen: () => panel.open };
}
