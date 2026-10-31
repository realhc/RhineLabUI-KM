import { archiveIdentity, archiveSeed, type ArchiveIdentitySource } from "./archive-identity.ts";

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

// Physical ink and paper use Radix Sand. The cover remains a print under the
// existing glass in both themes, just like a user's photograph.
const ink = "#21201c", paper = "#f1f0ef", rule = "#bcbbb5", secondary = "#63635e";
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
  context.textBaseline = "top";
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.strokeRect(20, 20, 472, 550);
  context.beginPath(); context.moveTo(20, 72); context.lineTo(492, 72); context.stroke();
  context.fillStyle = ink;
  context.font = `600 14px ${font}`;
  context.fillText("RHINE LAB / ARCHIVE", 36, 39);
  context.font = `500 18px ${font}`;
  const category = coverTextLines(context, identity.category, 400, 1)[0] || "未分类";
  context.fillText(category, 36, 95);
  context.font = `600 36px ${font}`;
  coverTextLines(context, source.title || "未命名档案", 432, 4)
    .forEach((line, index) => context.fillText(line, 36, 145 + index * 48));

  // Category shape echoes the directory and graph mark. Document ID determines
  // the modular tiles, so the geometry has a repeatable connection to content.
  context.save();
  context.translate(36, 375);
  context.strokeStyle = rule;
  context.lineWidth = 1.5;
  const cell = 26;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    context.strokeRect(col * cell, row * cell, cell, cell);
    if ((seed >>> ((row * 6 + col) % 32)) & 1) {
      context.fillStyle = ink;
      context.fillRect(col * cell + 4, row * cell + 4, cell - 8, cell - 8);
    }
  }
  context.restore();
  context.save();
  context.translate(374, 427);
  context.strokeStyle = ink;
  context.lineWidth = 5;
  context.beginPath();
  if (identity.mark === "○") context.arc(0, 0, 47, 0, Math.PI * 2);
  else if (identity.mark === "□") context.rect(-43, -43, 86, 86);
  else {
    const corners = identity.mark === "△" ? 3 : identity.mark === "⬡" ? 6 : 4;
    for (let index = 0; index < corners; index++) {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / corners;
      const x = Math.cos(angle) * 52, y = Math.sin(angle) * 52;
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
  }
  context.stroke();
  context.restore();
  context.strokeStyle = ink;
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(20, 511); context.lineTo(492, 511); context.stroke();
  context.fillStyle = secondary;
  context.font = `500 12px ${font}`;
  context.fillText("DOCUMENT ID", 36, 527);
  context.fillStyle = ink;
  context.font = `600 14px ${font}`;
  context.fillText(identity.code, 172, 526);
  return canvas;
}
