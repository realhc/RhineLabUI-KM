import { archiveSeed } from "./archive-identity.ts";

export type ArchivePatternFamily = "contour" | "flow" | "circuit";
type Palette = { accent: string; tint: string };
type Area = { x: number; y: number; width: number; height: number };

// Category controls the family; the document seed only changes its composition.
// All colors are Radix scale endpoints, printed beneath the unchanged glass.
export const archivePatternPalettes: Record<ArchivePatternFamily, Palette> = {
  contour: { accent: "#ab6400", tint: "#fefbe9" },
  flow: { accent: "#068c7f", tint: "#f3fbf9" },
  circuit: { accent: "#60646c", tint: "#f9f9fb" },
};

export function archivePatternFamily(category = "未分类"): ArchivePatternFamily {
  const name = category.trim().normalize("NFC") || "未分类";
  if (/生物|生命|生态|医疗|医学|植物|细胞|bio|life|ecolog|medical/i.test(name)) return "flow";
  if (/工程|系统|技术|计算|网络|软件|设备|流程|engineer|system|comput|software/i.test(name)) return "circuit";
  if (/材料|研究|观测|实验|测量|物理|地理|material|research|observ|experiment|physics/i.test(name)) return "contour";
  return (["contour", "flow", "circuit"] as const)[archiveSeed(name) % 3];
}

function randomFrom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = Math.imul(value ^ (value >>> 15), value | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function contour(context: CanvasRenderingContext2D, width: number, height: number, seed: number, accent: string) {
  const random = randomFrom(seed), miniature = height < 50;
  const peaks = Array.from({ length: 3 }, (_, index) => ({
    x: .2 + random() * .6, y: .22 + random() * .56,
    rx: .17 + random() * .18, ry: .2 + random() * .22,
    strength: index === 2 ? -.28 : .7 + random() * .35,
  }));
  const columns = miniature ? 22 : 54;
  const rows = miniature ? 8 : Math.max(12, Math.ceil(height / 8));
  const values = new Float32Array((columns + 1) * (rows + 1));
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const x = col / columns, y = row / rows;
    values[row * (columns + 1) + col] = peaks.reduce((sum, peak) => {
      const dx = (x - peak.x) / peak.rx, dy = (y - peak.y) / peak.ry;
      return sum + peak.strength * Math.exp(-(dx * dx + dy * dy));
    }, 0);
  }
  // A bounded Gaussian field produces topographic contours, never wave interference.
  const levels = miniature ? 5 : 13;
  for (let level = 0; level < levels; level++) {
    const threshold = .08 + level * (miniature ? .2 : .075);
    context.beginPath(); context.strokeStyle = accent;
    context.globalAlpha = level % 4 === 0 ? .85 : .48;
    context.lineWidth = miniature ? 1 : level % 4 === 0 ? 2.6 : 1.45;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const offset = row * (columns + 1) + col;
      const mask = Number(values[offset] < threshold)
        | (Number(values[offset + 1] < threshold) << 1)
        | (Number(values[offset + columns + 2] < threshold) << 2)
        | (Number(values[offset + columns + 1] < threshold) << 3);
      if (mask === 0 || mask === 15) continue;
      const corners = [
        [col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1],
      ];
      const cell = corners.map(([x, y]) => values[y * (columns + 1) + x]);
      const intersections: number[][] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if ((cell[edge] < threshold) === (cell[next] < threshold)) continue;
        const t = (threshold - cell[edge]) / (cell[next] - cell[edge]);
        intersections.push([
          (corners[edge][0] + (corners[next][0] - corners[edge][0]) * t) * width / columns,
          (corners[edge][1] + (corners[next][1] - corners[edge][1]) * t) * height / rows,
        ]);
      }
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        context.moveTo(intersections[index][0], intersections[index][1]);
        context.lineTo(intersections[index + 1][0], intersections[index + 1][1]);
      }
    }
    context.stroke();
  }
}

function flow(context: CanvasRenderingContext2D, width: number, height: number, seed: number, accent: string) {
  const random = randomFrom(seed), miniature = height < 50;
  const phase = random() * Math.PI * 2, bend = .24 + random() * .18;
  const count = miniature ? 5 : 34;
  const steps = miniature ? 45 : 125;
  // Static, bounded streamlines are generated once when the cover is cached.
  for (let line = 0; line < count; line++) {
    let x = -.025, y = (line + .5) / count;
    context.beginPath(); context.moveTo(x * width, y * height);
    context.strokeStyle = accent; context.globalAlpha = line % 6 === 0 ? .82 : .4;
    context.lineWidth = miniature ? 1 : line % 6 === 0 ? 3 : 1.35;
    for (let step = 0; step < steps; step++) {
      const angle = Math.sin(x * 4.3 + phase) * bend + Math.sin(y * 3.5 - phase) * .25;
      x += 1.08 / steps;
      y += Math.sin(angle) * .012;
      context.lineTo(x * width, y * height);
    }
    context.stroke();
  }
}

function circuit(context: CanvasRenderingContext2D, width: number, height: number, seed: number, accent: string) {
  const random = randomFrom(seed), miniature = height < 50;
  const gx = width / 14, gy = height / 10, count = miniature ? 4 : 16;
  for (let path = 0; path < count; path++) {
    const x = (1 + Math.floor(random() * 5)) * gx;
    const y = (1 + Math.floor(random() * 8)) * gy;
    const direction = random() < .5 ? -1 : 1;
    const endY = Math.max(gy, Math.min(9 * gy, y + direction * (1 + Math.floor(random() * 3)) * gy));
    const endX = (10 + Math.floor(random() * 4)) * gx;
    context.strokeStyle = accent; context.globalAlpha = path % 4 === 0 ? .85 : .46;
    context.lineWidth = miniature ? 1 : path % 4 === 0 ? 3.5 : 1.55;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + gx, y);
    context.lineTo(x + 2 * gx, endY); context.lineTo(endX, endY); context.stroke();
    context.beginPath(); context.arc(endX, endY, miniature ? 1 : 2.8, 0, Math.PI * 2); context.stroke();
    if (!miniature && path % 4 === 0) {
      context.fillStyle = accent; context.fillRect(x - 2.6, y - 2.6, 5.2, 5.2);
    }
  }
}

export function drawArchivePattern(
  context: CanvasRenderingContext2D,
  family: ArchivePatternFamily,
  seed: number,
  area: Area,
) {
  const { accent } = archivePatternPalettes[family];
  context.save();
  context.beginPath(); context.rect(area.x, area.y, area.width, area.height); context.clip();
  context.translate(area.x, area.y); context.lineCap = "round"; context.lineJoin = "round";
  ({ contour, flow, circuit }[family])(context, area.width, area.height, seed, accent);
  context.restore();
}
