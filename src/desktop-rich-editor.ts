import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Mathematics } from "@tiptap/extension-mathematics";
import "katex/dist/katex.min.css";

// Preserve attachment references without fetching local files or remote images.
const Attachment = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    src: { default: "" },
    alt: { default: "" },
    title: { default: null },
  }),
  parseHTML: () => [{ tag: "span[data-attachment]" }],
  renderHTML: ({ node }) => [
    "span",
    { "data-attachment": "", class: "attachment" },
    "[图片：" + (node.attrs.alt || "附件") + " — 暂不支持附件]",
  ],
  parseMarkdown: (token) => ({
    type: "image",
    attrs: { src: token.href, alt: token.text, title: token.title },
  }),
  renderMarkdown: (node) =>
    "![" +
    String(node.attrs?.alt || "").replace(/[\[\]]/g, "\\$&") +
    "](<" +
    String(node.attrs?.src || "").replace(/>/g, "%3E") +
    ">" +
    (node.attrs?.title
      ? ' "' + String(node.attrs.title).replace(/"/g, '\\"') + '"'
      : "") +
    ")",
});

// HTML code remains literal, as in the previous Markdown reader.
const LiteralHTML = Node.create({
  name: "literalHTML",
  group: "block",
  content: "text*",
  marks: "",
  parseHTML: () => [{ tag: "p[data-literal-html]" }],
  renderHTML: () => ["p", { "data-literal-html": "" }, 0],
  markdownTokenizer: {
    name: "literalHTML",
    level: "block",
    start: (src) => src.search(/<(script|style|iframe)\b/i),
    tokenize(src) {
      const m = /^ {0,3}<(script|style|iframe)\b[\s\S]*?<\/\1\s*>/i.exec(src);
      if (m) return { type: "literalHTML", raw: m[0], text: m[0] };
    },
  },
  parseMarkdown: (token) => ({
    type: "literalHTML",
    content: [{ type: "text", text: token.raw }],
  }),
  renderMarkdown: (node) =>
    (node.content || []).map((child) => child.text || "").join(""),
});

export const richToolbar =
  '<div class="format-group" role="group" aria-label="段落样式"><select id="text-style" aria-label="段落样式"><option value="0">正文</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option><option value="4">四级标题</option></select></div>' +
  '<div class="format-group" role="group" aria-label="文字格式">' +
  [
    ["bold", "B", "粗体 · Ctrl+B"],
    ["italic", "I", "斜体 · Ctrl+I"],
    ["underline", "U", "下划线 · Ctrl+U"],
    ["strike", "S", "删除线"],
  ]
    .map(
      ([action, label, title]) =>
        '<button data-command="' +
        action +
        '" aria-label="' +
        title +
        '" title="' +
        title +
        '">' +
        label +
        "</button>",
    )
    .join("") +
  "</div>" +
  '<div class="format-group" role="group" aria-label="列表与引用">' +
  [
    ["bulletList", "• 列表", "无序列表"],
    ["orderedList", "1. 列表", "有序列表"],
    ["blockquote", "引用", "引用"],
  ]
    .map(
      ([action, label, title]) =>
        '<button data-command="' + action + '" aria-label="' + title + '" title="' + title + '">' + label + '</button>',
    )
    .join("") +
  "</div>" +
  '<div class="format-group" role="group" aria-label="插入内容">' +
  [
    ["link", "链接", "插入或修改链接"],
    ["codeBlock", "代码块", "把选中的内容设为代码块"],
    ["math", "∑ 公式", "插入 LaTeX 公式"],
    ["table", "表格", "插入表格"],
  ]
    .map(
      ([action, label, title]) =>
        '<button data-command="' +
        action +
        '" title="' +
        title +
        '">' +
        label +
        "</button>",
    )
    .join("") +
  "</div>" +
  '<div class="format-group format-history" role="group" aria-label="编辑历史"><button data-command="undo" title="Ctrl+Z" aria-label="撤销 · Ctrl+Z">↶</button><button data-command="redo" title="Ctrl+Shift+Z" aria-label="重做 · Ctrl+Shift+Z">↷</button></div>' +
  '<div id="table-tools" class="format-group" role="group" aria-label="表格操作" hidden><button data-command="addRowAfter">＋行</button><button data-command="addColumnAfter">＋列</button><button data-command="deleteRow">删行</button><button data-command="deleteColumn">删列</button><button data-command="deleteTable">移除表格</button></div>' +
  '<select id="code-language" aria-label="代码语言" hidden><option value="">纯文本</option><option>javascript</option><option>typescript</option><option>python</option><option>json</option><option>html</option><option>css</option><option>bash</option><option>sql</option></select>';

type Request = (
  kind: "link" | "math" | "table",
  initial?: Record<string, string>,
) => Promise<Record<string, string> | null>;
export function mountRichEditor(
  element: HTMLElement,
  toolbar: HTMLElement,
  changed: () => void,
  request: Request,
) {
  let raw = "",
    documentId = "",
    editable = false;
  const math = async (latex: string, pos: number, block: boolean) => {
    if (!editable) return;
    const result = await request("math", {
      value: latex,
      display: block ? "block" : "inline",
    });
    if (!result) return;
    const chain = editor.chain().focus();
    if (block) chain.updateBlockMath({ latex: result.value, pos }).run();
    else chain.updateInlineMath({ latex: result.value, pos }).run();
  };
  const createEditor = () =>
    new Editor({
      element,
      editable: false,
      content: "",
      contentType: "markdown",
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            autolink: false,
            isAllowedUri: (url) => /^https?:\/\//i.test(url),
          },
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Attachment,
        LiteralHTML,
        TableKit,
        Mathematics.configure({
          katexOptions: { throwOnError: false, trust: false, strict: "ignore" },
          inlineOptions: {
            onClick: (node, pos) => void math(node.attrs.latex, pos, false),
          },
          blockOptions: {
            onClick: (node, pos) => void math(node.attrs.latex, pos, true),
          },
        }),
        Markdown,
      ],
      editorProps: {
        attributes: {
          class: "rich-document",
          role: "textbox",
          "aria-label": "文档正文",
          "aria-multiline": "true",
          spellcheck: "false",
        },
      },
      onUpdate: () => {
        raw = editor.getMarkdown();
        changed();
        updateToolbar();
      },
      onSelectionUpdate: () => updateToolbar(),
      onTransaction: () => updateToolbar(),
    });
  let editor = createEditor();
  function updateToolbar() {
    toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      const command = button.dataset.command!;
      button.disabled =
        !editable ||
        (command === "undo"
          ? !editor.can().undo()
          : command === "redo"
            ? !editor.can().redo()
            : false);
      const active = editor.isActive(command);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const style = toolbar.querySelector<HTMLSelectElement>("#text-style")!;
    style.disabled = !editable;
    style.value = String(
      editor.isActive("heading") ? editor.getAttributes("heading").level : 0,
    );
    toolbar.querySelector<HTMLElement>("#table-tools")!.hidden =
      !editable || !editor.isActive("table");
    const language =
      toolbar.querySelector<HTMLSelectElement>("#code-language")!;
    language.hidden = !editable || !editor.isActive("codeBlock");
    language.value = editor.getAttributes("codeBlock").language || "";
  }
  toolbar.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  });
  toolbar.querySelector<HTMLSelectElement>("#text-style")!.onchange = (
    event,
  ) => {
    if (!editable) return;
    const value = +(event.target as HTMLSelectElement).value;
    const chain = editor.chain().focus();
    if (value) chain.setHeading({ level: value as 1 | 2 | 3 | 4 }).run();
    else chain.setParagraph().run();
  };
  toolbar.querySelector<HTMLSelectElement>("#code-language")!.onchange = (
    event,
  ) =>
    editor
      .chain()
      .focus()
      .updateAttributes("codeBlock", {
        language: (event.target as HTMLSelectElement).value || null,
      })
      .run();
  toolbar.onclick = async (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-command]",
    )?.dataset.command;
    if (!action || !editable) return;
    const chain = editor.chain().focus();
    switch (action) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "underline":
        chain.toggleUnderline().run();
        break;
      case "strike":
        chain.toggleStrike().run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
      case "undo":
        chain.undo().run();
        break;
      case "redo":
        chain.redo().run();
        break;
      case "link": {
        const { from, to } = editor.state.selection;
        const result = await request("link", {
          value: editor.getAttributes("link").href || "",
          label: editor.state.doc.textBetween(from, to, " "),
        });
        if (!result) return;
        if (!result.value)
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
        else if (from === to && !editor.isActive("link"))
          editor
            .chain()
            .focus()
            .insertContent({
              type: "text",
              text: result.label || result.value,
              marks: [{ type: "link", attrs: { href: result.value } }],
            })
            .run();
        else
          editor
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href: result.value })
            .run();
        break;
      }
      case "math": {
        const result = await request("math", {
          value: editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            " ",
          ),
          display: "inline",
        });
        if (!result) return;
        if (result.display === "block")
          editor.chain().focus().insertBlockMath({ latex: result.value }).run();
        else
          editor
            .chain()
            .focus()
            .insertInlineMath({ latex: result.value })
            .run();
        break;
      }
      case "table": {
        const result = await request("table", { rows: "3", cols: "3" });
        if (result)
          editor
            .chain()
            .focus()
            .insertTable({
              rows: +result.rows,
              cols: +result.cols,
              withHeaderRow: true,
            })
            .run();
        break;
      }
      case "addRowAfter":
        chain.addRowAfter().run();
        break;
      case "addColumnAfter":
        chain.addColumnAfter().run();
        break;
      case "deleteRow":
        chain.deleteRow().run();
        break;
      case "deleteColumn":
        chain.deleteColumn().run();
        break;
      case "deleteTable":
        chain.deleteTable().run();
        break;
    }
  };
  return {
    body: () => raw,
    load(body: string, id: string) {
      if (id === documentId && body === raw) return;
      editor.destroy();
      editor = createEditor();
      documentId = id;
      raw = body;
      // Preserve original bytes until the user actually changes the content.
      editor
        .chain()
        .setMeta("addToHistory", false)
        .setContent(body, { contentType: "markdown", emitUpdate: false })
        .run();
      element.scrollTop = 0;
    },
    setEditable(value: boolean) {
      editable = value;
      editor.setEditable(value, false);
      element.classList.toggle("editing", value);
      editor.view.dom.setAttribute("aria-readonly", String(!value));
      updateToolbar();
    },
    focus: () => editor.commands.focus(),
  };
}
