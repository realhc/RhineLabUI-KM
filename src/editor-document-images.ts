import { Node, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { cacheDocumentImage, isDocumentImageSource, loadDocumentImage } from "./document-images";

export type DocumentImageEditorOptions = {
  notice?: (message: string) => void;
  busyChanged?: (busy: boolean) => void;
};
type ImportedImage = { src: string; dataUrl: string; name?: string };
type Anchor = { id: number; from: number; to: number };
type ImportTask = { id: number; generation: number; editor: Editor; documentId: string };
type AnchorMeta = { add?: Anchor; remove?: number };
type Configuration = DocumentImageEditorOptions & {
  editor: () => Editor;
  documentId: () => string;
  editable: () => boolean;
};

function inCode(view: EditorView, position: number) {
  const point = view.state.doc.resolve(position);
  for (let depth = point.depth; depth > 0; depth--)
    if (point.node(depth).type.spec.code) return true;
  return false;
}

export function createDocumentImageEditor(config: Configuration) {
  const key = new PluginKey<Map<number, Anchor>>("document-image-imports");
  const tasks = new Map<number, ImportTask>();
  const idle = new Set<() => void>();
  let generation = 0, sequence = 0, lastBusy = false;
  function reportBusy() {
    const busy = tasks.size > 0;
    if (busy !== lastBusy) { lastBusy = busy; config.busyChanged?.(busy); }
    if (!busy) { for (const resolve of idle) resolve(); idle.clear(); }
  }
  function current(task: ImportTask) {
    return task.generation === generation && !task.editor.isDestroyed &&
      task.editor === config.editor() && task.documentId === config.documentId();
  }
  function remove(task: ImportTask) {
    tasks.delete(task.id);
    if (current(task))
      task.editor.view.dispatch(task.editor.state.tr.setMeta(key, { remove: task.id }).setMeta("addToHistory", false));
    reportBusy();
  }
  function begin(editor: Editor, from: number, to = from) {
    if (!config.editable() || !config.documentId()) {
      config.notice?.("请先编辑文档，再插入图片。");
      return;
    }
    if (inCode(editor.view, from) || inCode(editor.view, to)) {
      config.notice?.("请先把光标移到代码块外，再插入图片。");
      return;
    }
    // A drop near a block edge still inserts into the nearest text block.
    const selection = Selection.near(editor.state.doc.resolve(from));
    if (!selection.$from.parent.inlineContent) {
      config.notice?.("请在正文段落中插入图片。");
      return;
    }
    if (!editor.state.doc.resolve(from).parent.inlineContent) from = to = selection.from;
    if (inCode(editor.view, from)) {
      config.notice?.("请先把光标移到代码块外，再插入图片。");
      return;
    }
    const task = { id: ++sequence, generation, editor, documentId: config.documentId() };
    tasks.set(task.id, task);
    editor.view.dispatch(editor.state.tr.setMeta(key, { add: { id: task.id, from, to } }).setMeta("addToHistory", false));
    reportBusy();
    return task;
  }
  function insert(task: ImportTask, images: ImportedImage[]) {
    if (!current(task) || !config.editable()) return;
    const editor = task.editor;
    const anchor = key.getState(editor.state)?.get(task.id);
    if (!anchor || !images.length) return;
    if (inCode(editor.view, anchor.from) || inCode(editor.view, anchor.to)) {
      config.notice?.("图片位置已移入代码块，请在正文中重新插入。");
      return;
    }
    const nodes = images.filter(image => isDocumentImageSource(image.src)).map(image => {
      cacheDocumentImage(task.documentId, image.src, image.dataUrl);
      return editor.schema.nodes.image.create({ src: image.src, alt: image.name || "图片" });
    });
    if (!nodes.length) return;
    const tr = closeHistory(editor.state.tr)
      .replaceWith(anchor.from, anchor.to, Fragment.fromArray(nodes))
      .setMeta(key, { remove: task.id });
    editor.view.dispatch(tr.scrollIntoView());
    // The completed batch is one undo step, independent of subsequent typing.
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  }
  async function importFiles(task: ImportTask, files: File[]) {
    const imported: ImportedImage[] = [];
    let failures = 0;
    try {
      for (const file of files) {
        if (!current(task)) return;
        if (!/^image\/(?:png|jpeg)$/i.test(file.type) && !/\.(?:png|jpe?g)$/i.test(file.name)) {
          failures++;
          continue;
        }
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB。");
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!current(task)) return;
          const result = await window.rhine.importDocumentImage(task.documentId, bytes);
          imported.push({ ...result, name: result.name || file.name });
        } catch (error) {
          failures++;
          if (current(task)) config.notice?.(error instanceof Error ? error.message : "图片导入失败。");
        }
      }
      if (current(task)) {
        insert(task, imported);
        if (failures && !imported.length) config.notice?.("未导入图片，请选择有效的 PNG 或 JPEG 文件。");
        else if (failures) config.notice?.("部分图片未导入，请检查文件格式和大小。");
      }
    } catch (error) {
      if (current(task)) config.notice?.(error instanceof Error ? error.message : "图片导入失败。");
    } finally { remove(task); }
  }
  const extension = Node.create({
    name: "image",
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => ({
      src: { default: "", rendered: false, parseHTML: element => {
        const src = element.getAttribute("data-src") || "";
        return isDocumentImageSource(src) ? src : "";
      } },
      alt: { default: "", rendered: false, parseHTML: element => element.getAttribute("data-alt") || "" },
      title: { default: null, rendered: false, parseHTML: element => element.getAttribute("data-title") },
    }),
    parseHTML: () => [{
      tag: "span[data-document-image][data-src]",
      getAttrs: element => {
        if (!(element instanceof HTMLElement)) return false;
        const src = element.getAttribute("data-src") || "";
        return isDocumentImageSource(src)
          ? { src, alt: element.getAttribute("data-alt") || "", title: element.getAttribute("data-title") }
          : false;
      },
    }],
    renderHTML: ({ node }) => isDocumentImageSource(node.attrs.src)
      ? ["span", { "data-document-image": "", "data-src": node.attrs.src, "data-alt": node.attrs.alt || "", ...(node.attrs.title ? { "data-title": node.attrs.title } : {}), class: "document-image" }, "[图片：" + (node.attrs.alt || "图片") + "]"]
      : ["span", { class: "attachment" }, "[图片：" + (node.attrs.alt || "附件") + "]"],
    parseMarkdown: token => ({ type: "image", attrs: { src: token.href, alt: token.text, title: token.title } }),
    renderMarkdown: node => "![" + String(node.attrs?.alt || "").replace(/\\/g, "\\\\").replace(/[\[\]]/g, "\\$&") + "](<" + String(node.attrs?.src || "").replace(/>/g, "%3E") + ">" + (node.attrs?.title ? ' "' + String(node.attrs.title).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : "") + ")",
    addNodeView: () => ({ node }) => {
      const dom = document.createElement("span"), src = String(node.attrs.src || "");
      dom.contentEditable = "false";
      if (!isDocumentImageSource(src)) {
        dom.className = "attachment";
        dom.textContent = "[图片：" + (node.attrs.alt || "附件") + "]";
        return { dom, ignoreMutation: () => true };
      }
      dom.className = "document-image";
      dom.dataset.src = src;
      dom.dataset.documentImage = "";
      const image = document.createElement("img");
      image.className = "document-image-content";
      image.dataset.src = src;
      image.alt = String(node.attrs.alt || "图片");
      if (node.attrs.title) image.title = String(node.attrs.title);
      image.draggable = false;
      const state = document.createElement("span");
      state.className = "document-image-state";
      state.textContent = "正在读取图片…";
      dom.append(image, state);
      let destroyed = false;
      image.onload = () => { if (!destroyed) state.remove(); };
      image.onerror = () => { if (!destroyed) state.textContent = "图片无法读取"; };
      void loadDocumentImage(config.documentId(), src).then(dataUrl => {
        if (!destroyed) image.src = dataUrl;
      }).catch(() => { if (!destroyed) state.textContent = "图片无法读取"; });
      return { dom, ignoreMutation: () => true, destroy() { destroyed = true; image.onload = image.onerror = null; } };
    },
    addProseMirrorPlugins: () => [new Plugin<Map<number, Anchor>>({
      key,
      state: {
        init: () => new Map(),
        apply(tr, value) {
          const next = new Map<number, Anchor>();
          for (const [id, anchor] of value) {
            const from = tr.mapping.map(anchor.from, 1), to = tr.mapping.map(anchor.to, -1);
            next.set(id, { id, from, to: Math.max(from, to) });
          }
          const meta = tr.getMeta(key) as AnchorMeta | undefined;
          if (meta?.add) next.set(meta.add.id, meta.add);
          if (meta?.remove !== undefined) next.delete(meta.remove);
          return next;
        },
      },
      props: {
        decorations(state) {
          return DecorationSet.create(state.doc, [...(key.getState(state)?.values() || [])].map(anchor => Decoration.widget(anchor.from, () => {
            const pending = document.createElement("span");
            pending.className = "document-image-pending";
            pending.dataset.imageImport = String(anchor.id);
            pending.setAttribute("role", "status");
            pending.textContent = "正在导入图片…";
            return pending;
          }, { key: String(anchor.id), side: 1 })));
        },
      },
    })],
  });
  return {
    extension,
    busy: () => tasks.size > 0,
    whenIdle: () => tasks.size ? new Promise<void>(resolve => idle.add(resolve)) : Promise.resolve(),
    reset() { generation++; tasks.clear(); reportBusy(); },
    sanitizeHTML(html: string) {
      // Template contents stay inert while removing resource-bearing HTML.
      // Canonical span references from the editor clipboard remain parseable.
      const template = document.createElement("template");
      template.innerHTML = html;
      for (const image of template.content.querySelectorAll("img"))
        image.replaceWith(document.createTextNode("[图片：" + (image.getAttribute("alt") || "附件") + "]"));
      for (const resource of template.content.querySelectorAll("picture,source,iframe,frame,frameset,object,embed,script,style,link,meta,base,audio,video,svg,math,canvas")) resource.remove();
      for (const element of template.content.querySelectorAll("*")) {
        for (const attribute of [...element.attributes]) {
          if (/^(?:on|src$|srcset$|poster$|style$|background$|xlink:)/i.test(attribute.name))
            element.removeAttribute(attribute.name);
        }
      }
      return template.innerHTML;
    },
    async pick(editor: Editor) {
      const task = begin(editor, editor.state.selection.from, editor.state.selection.to);
      if (!task) return;
      try {
        const result = await window.rhine.pickDocumentImages(task.documentId);
        if (result && current(task)) insert(task, result);
      } catch (error) {
        if (current(task)) config.notice?.(error instanceof Error ? error.message : "图片导入失败。");
      } finally { remove(task); }
    },
    drop(view: EditorView, event: DragEvent) {
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return false;
      event.preventDefault();
      if (files.length > 10) { config.notice?.("每次最多插入 10 张图片。"); return true; }
      const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!point) { config.notice?.("请把图片拖到正文段落中。"); return true; }
      const task = begin(config.editor(), point.pos);
      if (task) void importFiles(task, files);
      return true;
    },
    paste(view: EditorView, event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return false;
      event.preventDefault();
      if (files.length > 10) { config.notice?.("每次最多插入 10 张图片。"); return true; }
      const task = begin(config.editor(), view.state.selection.from, view.state.selection.to);
      if (task) void importFiles(task, files);
      return true;
    },
  };
}
