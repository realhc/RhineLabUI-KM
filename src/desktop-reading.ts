import "./desktop-reading.css";
import { archiveIdentity } from "./archive-identity";

/** All navigation furniture lives outside ProseMirror and its undo history. */
export function mountReadingNavigation(preview: HTMLElement, panes: HTMLElement) {
  const outline = document.createElement("nav");
  outline.id = "reading-outline";
  outline.setAttribute("aria-label", "文内大纲");
  outline.hidden = true;
  outline.innerHTML = '<header><strong>文内大纲</strong><button type="button" aria-label="收起文内大纲">×</button></header><div class="outline-items"></div>';
  panes.prepend(outline);
  const plate = document.createElement("div");
  plate.id = "archive-identity";
  plate.innerHTML = '<span class="archive-mark" aria-hidden="true"></span><span class="archive-code"></span><span class="archive-category"></span><span class="archive-date"></span>';
  preview.prepend(plate);
  const progress = document.createElement("div");
  progress.id = "reading-position";
  progress.innerHTML = '<span class="reading-section"></span><span class="reading-percent"></span><span class="reading-meter" aria-hidden="true"><i></i></span>';
  panes.after(progress);
  let doc: RhineDocument | undefined, headings: HTMLElement[] = [], active = -1;
  let pending = 0, restoring = 0, signature = "", root: Element | null = null;
  const positions = new Map<string, number>();
  function capture() {
    if (!doc || restoring) return;
    positions.delete(doc.id); positions.set(doc.id, panes.scrollTop);
    if (positions.size > 200) positions.delete(positions.keys().next().value!);
  }
  function toggle(force = outline.hidden) {
    outline.hidden = !force;
    panes.dataset.outlineOpen = String(force);
    document.querySelector('#reading-outline-toggle')?.setAttribute('aria-expanded', String(force));
    schedule();
  }
  outline.querySelector("button")!.onclick = () => toggle(false);
  function jump(index: number) {
    const heading = headings[index]; if (!heading) return;
    panes.scrollTop += heading.getBoundingClientRect().top - panes.getBoundingClientRect().top - 24;
    measure();
  }
  function measure() {
    pending = 0;
    if (!doc) { progress.hidden = plate.hidden = true; return; }
    // The document's grid row can exceed the viewport; keep the sticky outline scrollable.
    panes.style.setProperty('--reading-viewport-height', `${panes.clientHeight}px`);
    const content = preview.querySelector('.rich-document');
    const nodes = Array.from(preview.querySelectorAll<HTMLElement>('.rich-document :is(h1,h2,h3,h4,h5,h6)')).slice(0, 300);
    const nextSignature = nodes.map(item => item.tagName + ':' + item.textContent).join('\n');
    if (signature !== nextSignature || root !== content) {
      signature = nextSignature; root = content; headings = nodes; active = -1;
      const items = outline.querySelector('.outline-items')!;
      items.replaceChildren();
      if (!nodes.length) { const empty = document.createElement('p'); empty.textContent = '正文中尚无标题'; items.append(empty); }
      nodes.forEach((heading, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.level = heading.tagName.slice(1);
        const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
        const label = document.createElement('span'); label.textContent = heading.textContent || '未命名章节';
        button.append(number, label); button.onclick = () => jump(index); items.append(button);
      });
    }
    const top = panes.getBoundingClientRect().top + 48;
    let index = -1;
    for (let i = 0; i < headings.length; i++) { if (headings[i].getBoundingClientRect().top <= top) index = i; else break; }
    if (index < 0 && headings.length) index = 0;
    if (index !== active) {
      active = index;
      outline.querySelectorAll<HTMLButtonElement>('.outline-items button').forEach((button, i) => {
        if (i === active) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
      });
    }
    progress.querySelector('.reading-section')!.textContent = active >= 0 ? `${String(active + 1).padStart(2, '0')} / ${headings.length}  ${headings[active].textContent}` : '正文';
    const max = panes.scrollHeight - panes.clientHeight;
    const percent = max > 1 ? Math.round(100 * panes.scrollTop / max) : 100;
    progress.querySelector('.reading-percent')!.textContent = `${percent}%`;
    (progress.querySelector('i') as HTMLElement).style.width = `${percent}%`;
    progress.hidden = plate.hidden = false;
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(measure); }
  panes.addEventListener('scroll', () => { capture(); schedule(); }, { passive: true });
  const observer = new MutationObserver(records => {
    if (records.some(record => !plate.contains(record.target) && !(record.target instanceof Element && record.target.closest('#document-drafting')))) schedule();
  });
  observer.observe(preview, { subtree: true, childList: true, characterData: true });
  new ResizeObserver(schedule).observe(panes);
  return {
    capture, toggle,
    update(next: RhineDocument | undefined, changed: boolean) {
      doc = next;
      if (next) {
        const identity = archiveIdentity(next);
        plate.querySelector('.archive-code')!.textContent = identity.code;
        plate.querySelector('.archive-category')!.textContent = identity.category;
        plate.querySelector('.archive-mark')!.textContent = identity.mark;
        plate.querySelector('.archive-date')!.textContent = next.modified.slice(0, 10);
        plate.title = next.id;
      }
      schedule();
      if (changed) {
        cancelAnimationFrame(restoring);
        const id = next?.id;
        restoring = requestAnimationFrame(() => {
          restoring = 0;
          if (doc?.id === id) { panes.scrollTop = id ? positions.get(id) || 0 : 0; measure(); }
        });
      }
    },
  };
}

export function mountQuickSwitcher(overlay: HTMLElement, hooks: { documents: () => RhineDocument[]; navigate: (id: string) => Promise<unknown> }) {
  const panel = document.createElement('dialog'); panel.id = 'reading-switcher';
  panel.setAttribute('aria-label', '快速切换文档');
  panel.innerHTML = '<header><strong>快速切换</strong><button type="button" aria-label="关闭快速切换">×</button></header><input type="search" aria-label="查找文档" placeholder="输入标题、分类或编号" autocomplete="off"><div class="switcher-results"></div>';
  overlay.append(panel);
  const input = panel.querySelector('input')!, results = panel.querySelector('.switcher-results')!;
  let matches: RhineDocument[] = [], index = 0, opener: HTMLElement | null = null;
  function close() { panel.close(); opener?.focus({ preventScroll: true }); }
  async function choose(id: string) { close(); await hooks.navigate(id); }
  function paint() {
    const query = input.value.trim().toLocaleLowerCase();
    matches = hooks.documents().filter(doc => `${doc.title}\n${doc.category}\n${doc.id}`.toLocaleLowerCase().includes(query)).sort((a, b) => {
      const exact = Number(b.title.toLocaleLowerCase().startsWith(query)) - Number(a.title.toLocaleLowerCase().startsWith(query));
      return exact || b.modified.localeCompare(a.modified);
    }).slice(0, 30);
    index = Math.max(0, Math.min(index, matches.length - 1)); results.replaceChildren();
    matches.forEach((doc, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('aria-current', String(index === i));
      const title = document.createElement('strong'); title.textContent = doc.title;
      const detail = document.createElement('span'); detail.textContent = `${archiveIdentity(doc).code} / ${doc.category || '未分类'}`;
      button.append(title, detail); button.onclick = () => void choose(doc.id); results.append(button);
    });
    if (!matches.length) results.textContent = '没有匹配的文档';
  }
  input.oninput = () => { index = 0; paint(); };
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1); paint();
      results.children[index]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && matches[index]) { event.preventDefault(); void choose(matches[index].id); }
  };
  panel.querySelector('header button')!.addEventListener('click', close);
  panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
  return { panel, close, open() { opener = document.activeElement as HTMLElement; input.value = ''; index = 0; paint(); if (!panel.open) panel.showModal(); input.focus(); } };
}
