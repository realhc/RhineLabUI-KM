import "./desktop-drafting.css";

const NS = "http://www.w3.org/2000/svg";
const svgElement = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number> = {}) => {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

/** Decorations stay outside ProseMirror: they never enter Markdown, selection or undo. */
export function mountDocumentDrafting(preview: HTMLElement) {
  const sheet = svgElement("svg", { id: "document-drafting", "aria-hidden": "true", focusable: "false" });
  sheet.innerHTML = '<defs><pattern id="document-grid-minor" patternUnits="userSpaceOnUse" width="24" height="24"><path d="M24 .5H.5V24"/></pattern><pattern id="document-grid-major" patternUnits="userSpaceOnUse" width="96" height="96"><path d="M96 .5H.5V96"/></pattern></defs><rect class="draft-paper-minor" width="100%" height="100%"/><rect class="draft-paper-major" width="100%" height="100%"/><g class="draft-guides"></g>';
  preview.prepend(sheet);
  const guides = sheet.querySelector<SVGGElement>(".draft-guides")!;
  const patterns = sheet.querySelectorAll<SVGPatternElement>("pattern");
  let frame = 0, disposed = false;

  function draw() {
    frame = 0;
    if (disposed) return;
    const content = preview.querySelector<HTMLElement>(".rich-document");
    const area = preview.getBoundingClientRect();
    if (!content || !area.width || !area.height) { sheet.setAttribute("hidden", ""); return; }
    const bounds = content.getBoundingClientRect();
    // Read geometry together, before changing the decorative SVG.
    const headings = Array.from(content.querySelectorAll<HTMLElement>(":scope > h1, :scope > h2")).slice(0, 200).flatMap(heading => {
      if (!heading.textContent?.trim()) return [];
      const range = document.createRange();
      range.selectNodeContents(heading);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? [{ rect, size: parseFloat(getComputedStyle(heading).fontSize), level: heading.tagName }] : [];
    });
    const originX = bounds.left - area.left;
    const originY = headings.length ? headings[0].rect.top - area.top : bounds.top - area.top;
    sheet.removeAttribute("hidden");
    sheet.setAttribute("width", String(area.width));
    sheet.setAttribute("height", String(area.height));
    for (const pattern of patterns) {
      const unit = Number(pattern.getAttribute("width"));
      pattern.setAttribute("x", String(originX % unit));
      pattern.setAttribute("y", String(originY % unit));
    }
    const fragment = document.createDocumentFragment();
    for (const x of [originX, originX + bounds.width]) fragment.append(svgElement("line", {
      class: "draft-rail", x1: x + .5, x2: x + .5, y1: 0, y2: area.height,
    }));
    for (const { rect, size, level } of headings) {
      const x = rect.left - area.left, y = rect.top - area.top;
      const width = Math.min(bounds.right - rect.left, Math.ceil((rect.width + 8) / 24) * 24);
      const height = Math.ceil(rect.height / 24) * 24;
      const group = svgElement("g", { "data-draft-heading": level, "data-text-x": x, "data-text-y": y });
      group.append(svgElement("rect", { class: "draft-heading-box", x: x - .5, y: y - .5, width, height }));
      // Its inner corner is the measured text origin, rather than a guessed row offset.
      group.append(svgElement("path", { class: "draft-heading-corner", d: `M${x - 8} ${y - .5}H${x - .5}V${y + 8} M${x + width - 8} ${y + height - .5}H${x + width - .5}V${y + height - 8}` }));
      const endY = y + Math.min(size, rect.height);
      group.append(svgElement("path", { class: "draft-dimension", d: `M${x - 12} ${y}H${x - 18}V${endY}H${x - 12}` }));
      const label = svgElement("text", { class: "draft-size", x: x - 23, y: (y + endY) / 2, "text-anchor": "end", "dominant-baseline": "central" });
      label.textContent = String(Math.round(size));
      group.append(label);
      fragment.append(group);
    }
    guides.replaceChildren(fragment);
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
  const resize = new ResizeObserver(schedule);
  resize.observe(preview);
  const mutation = new MutationObserver(records => {
    if (records.some(record => record.target !== sheet && !sheet.contains(record.target))) schedule();
  });
  mutation.observe(preview, { subtree: true, childList: true, characterData: true });
  document.fonts.ready.then(schedule);
  document.fonts.addEventListener("loadingdone", schedule);
  schedule();
  return { destroy() {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect(); mutation.disconnect();
    document.fonts.removeEventListener("loadingdone", schedule);
    sheet.remove();
  } };
}
