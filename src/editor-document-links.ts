import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** [[ is an editing gesture; persisted output remains an ordinary Markdown link. */
export function documentLinkSuggestions(documents: () => RhineDocument[]) {
  return Extension.create({
    name: 'documentLinkSuggestions',
    addProseMirrorPlugins() {
      let popup: HTMLDivElement | undefined, view: EditorView, matches: RhineDocument[] = [];
      let start = 0, end = 0, index = 0, dismissed = '', signature = '';
      function hide() { popup?.remove(); popup = undefined; signature = ''; }
      function choose(target: RhineDocument) {
        if (!view.editable || view.state.selection.from !== end || !documents().some(doc => doc.id === target.id)) return;
        const text = view.state.schema.text(target.title, [view.state.schema.marks.link.create({ href: `${target.id}.md` })]);
        view.dispatch(view.state.tr.replaceWith(start, end, text).scrollIntoView()); view.focus(); hide();
      }
      function update(next: EditorView) {
        view = next;
        const { $from, empty } = view.state.selection;
        if (!view.editable || !empty || $from.parent.type.spec.code || view.state.storedMarks?.some(mark => mark.type.name === 'code') || $from.marks().some(mark => ['code','link'].includes(mark.type.name))) { hide(); return; }
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n');
        const match = /\[\[([^\[\]\n]{0,120})$/.exec(before);
        if (!match) { dismissed = ''; hide(); return; }
        start = $from.pos - match[0].length; end = $from.pos;
        const query = match[1].trim().toLocaleLowerCase();
        const token = `${start}:${end}:${query}`;
        if (token === dismissed) { hide(); return; }
        matches = documents().filter(doc => `${doc.title}\n${doc.category}`.toLocaleLowerCase().includes(query)).slice(0, 8);
        if (token !== signature) index = 0;
        signature = token;
        if (!matches.length) { hide(); return; }
        if (!popup) { popup = document.createElement('div'); popup.className = 'document-link-suggestions'; popup.setAttribute('role','listbox'); popup.setAttribute('aria-label','关联文档'); view.dom.closest('#preview')!.append(popup); }
        popup.replaceChildren();
        matches.forEach((doc, i) => { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','option'); button.setAttribute('aria-selected',String(i===index)); button.textContent = doc.title; button.title = doc.category || '未分类'; button.onmousedown = event => event.preventDefault(); button.onclick = () => choose(doc); popup!.append(button); });
        const point = view.coordsAtPos(end), width = Math.min(320, innerWidth - 32);
        popup.style.width = `${width}px`; popup.style.left = `${Math.max(12, Math.min(point.left,innerWidth-width-12))}px`;
        popup.style.top = `${Math.max(12,Math.min(point.bottom+6, innerHeight-300))}px`;
      }
      return [new Plugin({
        view(initial) { update(initial); return { update, destroy: hide }; },
        props: { handleKeyDown(next, event) {
          if (!popup || event.isComposing) return false;
          if (event.key === 'Escape') { dismissed = signature; hide(); return true; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; update(next); return true; }
          if ((event.key === 'Enter' || event.key === 'Tab') && matches[index]) { choose(matches[index]); return true; }
          return false;
        } },
      })];
    },
  });
}
