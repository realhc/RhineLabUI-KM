import { archiveIdentity, archiveSeed, type ArchiveIdentitySource } from "./archive-identity.ts";
import { archivePatternFamily, archivePatternPalettes, drawArchivePattern } from "./archive-patterns.ts";

export { archivePatternFamily } from "./archive-patterns.ts";
export type ArchiveCoverSource = ArchiveIdentitySource & { title: string };

/** The print is derived in memory; it never becomes document metadata or an asset. */
export function archiveCoverKey(source: ArchiveCoverSource) {
  return JSON.stringify([source.id, source.title, source.category || "未分类"]);
}

export function coverTextLines(
  context: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  width: number,
  limit: number,
) {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  let line = "";
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (line && context.measureText(line + character).width > width) {
      if (lines.length === limit - 1) {
        while (line && context.measureText(line + "…").width > width) line = Array.from(line).slice(0, -1).join("");
        lines.push(line.trimEnd() + "…");
        return lines;
      }
      lines.push(line.trimEnd());
      line = character.trimStart();
    } else line += character;
  }
  if (line) lines.push(line);
  return lines;
}

// Printed Radix Sand remains physical ink and paper beneath the existing glass.
const ink = "#21201c", paper = "#f1f0ef", secondary = "#63635e";
const font = '"MiSans", "Microsoft YaHei", sans-serif';

export function createArchiveCover(source: ArchiveCoverSource, width = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width * 3.05 / 2.65);
  const context = canvas.getContext("2d")!;
  context.scale(width / 512, canvas.height / 590);
  context.fillStyle = paper;
  context.fillRect(0, 0, 512, 590);
  const identity = archiveIdentity(source), seed = archiveSeed(source.id);
  const family = archivePatternFamily(identity.category), palette = archivePatternPalettes[family];
  context.textBaseline = "top";
  // The tightly packed array mainly exposes this existing upper print region.
  context.fillStyle = palette.tint; context.fillRect(21, 21, 470, 50);
  drawArchivePattern(context, family, seed, { x: 394, y: 33, width: 82, height: 27 });
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.strokeRect(20, 20, 472, 550);
  context.strokeStyle = palette.accent;
  context.beginPath(); context.moveTo(20, 72); context.lineTo(492, 72); context.stroke();
  context.fillStyle = ink;
  context.font = `600 14px ${font}`;
  context.fillText("RHINE LAB / ARCHIVE", 36, 39);
  context.font = `500 18px ${font}`;
  const category = coverTextLines(context, identity.category, 352, 1)[0] || "未分类";
  context.fillText(category, 36, 95);
  context.font = `600 36px ${font}`;
  const title = coverTextLines(context, source.title || "未命名档案", 432, 4);
  title.forEach((line, index) => context.fillText(line, 36, 145 + index * 48));

  // Longer titles reserve their real line area; no generated marks overlap text.
  const top = Math.min(359, 145 + title.length * 48 + 16);
  drawArchivePattern(context, family, seed, { x: 36, y: top, width: 432, height: 489 - top });
  // Keep the category's shared identity glyph outside the changing pattern field.
  context.save(); context.translate(450, 104);
  context.strokeStyle = palette.accent; context.lineWidth = 2;
  context.beginPath();
  if (identity.mark === "○") context.arc(0, 0, 16, 0, Math.PI * 2);
  else if (identity.mark === "□") context.rect(-14, -14, 28, 28);
  else {
    const corners = identity.mark === "△" ? 3 : identity.mark === "⬡" ? 6 : 4;
    for (let index = 0; index < corners; index++) {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / corners;
      const x = Math.cos(angle) * 17, y = Math.sin(angle) * 17;
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
  }
  context.stroke(); context.restore();
  context.strokeStyle = ink; context.lineWidth = 2;
  context.beginPath(); context.moveTo(20, 511); context.lineTo(492, 511); context.stroke();
  context.fillStyle = secondary;
  context.font = `500 12px ${font}`;
  context.fillText("DOCUMENT ID", 36, 527);
  context.fillStyle = ink;
  context.font = `600 14px ${font}`;
  context.fillText(identity.code, 172, 526);
  return canvas;
}
