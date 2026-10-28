import MarkdownIt from "markdown-it";
import { escapeHtml } from "./html";
import { isDocumentImageSource } from "./document-images";
const markdown = new MarkdownIt({ html: false, linkify: true });
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], src = token.attrGet("src");
  if (!isDocumentImageSource(src)) return '<span>[图片：' + escapeHtml(token.content) + ']</span>';
  return '<span class="document-image" data-document-image="' + escapeHtml(src) + '" data-alt="' + escapeHtml(String(token.content)) + '" data-title="' + escapeHtml(String(token.attrGet("title") || "")) + '" aria-busy="true">图片加载中</span>';
};
export const renderMarkdown = (body: string) => markdown.render(body);
