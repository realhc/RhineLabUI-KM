import content from "../content/archives.json" with { type: "json" };
export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
}
export let desktopCategories: RhineCategory[] = [];
export let desktopNextLane = 5;
let canonicalSlots = new Map<number, number>();
export let desktopDocuments: RhineDocument[] = [];
export const records: ArchiveRecord[] = content.records.map((record) => ({
  ...record,
}));
export const categories = ["全部档案", ...content.categories];
export const archiveColumns = [...content.columns];
// Forty exhibit slots preserve the exact original camera and array geometry.
// They are a view of the library; the editor indexes every Markdown document.
let slotLanes = content.records.map((record) =>
  content.columns.indexOf(record.category),
);
let slots = content.columns.map((_, lane) =>
  slotLanes.flatMap((value, index) => (value === lane ? [index] : [])),
);
const original = new Map(content.records.map((record) => [record.id, record]));
function recordFor(
  doc: RhineDocument | undefined,
  index: number,
): ArchiveRecord {
  if (!doc)
    return {
      id: "EMPTY-" + index,
      title: "空档案位 · 新建文档",
      en: "NEW ARCHIVE",
      department: "本地知识库",
      category: archiveColumns[slotLanes[index]],
      date: "—",
      lead: "—",
      clearance: "AVAILABLE",
      abstract: "从 ARCHIVE INDEX 创建第一篇 Markdown 文档。",
      findings: [],
      source: "",
    };
  const sample = original.get(doc.id);
  const metadata = sample
    ? [
        ["英文名称", sample.en],
        ["部门", sample.department],
        ["档案日期", sample.date],
        ["负责人", sample.lead],
        ["访问级别", sample.clearance],
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => "- **" + label + "**：" + value)
        .join("\n")
    : "";
  const sampleBody = sample
    ? "# " +
      sample.title +
      "\n\n" +
      metadata +
      "\n\n## 摘要\n\n" +
      sample.abstract +
      "\n\n## 研究记录\n\n" +
      sample.findings.map((item) => "- " + item).join("\n") +
      "\n\n## 参考来源\n\n[参考来源](" +
      sample.source +
      ")\n"
    : "";
  const unchanged = sample && doc.body === sampleBody;
  return {
    ...(unchanged
      ? sample
      : {
          en: "LOCAL ARCHIVE",
          department: doc.category || "未分类",
          date: doc.modified.slice(0, 10),
          lead: "LOCAL WORKSPACE",
          clearance: "LOCAL DOCUMENT",
          abstract: doc.body,
          findings: [],
          source: "",
        }),
    id: doc.id,
    title: doc.title,
    category: doc.category || "未分类",
  };
}
export function setDesktopDocuments(
  documents: RhineDocument[],
  groups?: RhineCategory[],
  nextLane?: number,
) {
  desktopDocuments = [...documents];
  desktopCategories = groups
    ? groups.map((c) => ({ ...c }))
    : [
        ...new Set(
          documents.map((d) => d.category).filter((c) => c && c !== "未分类"),
        ),
      ].map((name) => ({
        id: name,
        name,
        lane: content.columns.includes(name)
          ? content.columns.indexOf(name)
          : content.columns.length +
            [...new Set(documents.map((d) => d.category))]
              .filter((n) => !content.columns.includes(n))
              .indexOf(name),
      }));
  desktopNextLane = Math.max(
    5,
    nextLane ?? 0,
    ...desktopCategories.map((c) => c.lane + 1),
  );
  const rootDocs = documents.filter((doc) =>
    groups ? !doc.categoryId : !doc.category || doc.category === "未分类",
  );
  const laneCount = desktopNextLane + (rootDocs.length ? 1 : 0);
  archiveColumns.splice(
    0,
    archiveColumns.length,
    ...Array.from(
      { length: laneCount },
      (_, lane) =>
        desktopCategories.find((c) => c.lane === lane)?.name ??
        (lane === desktopNextLane ? "未分类" : "空分类"),
    ),
  );
  categories.splice(
    0,
    categories.length,
    "全部档案",
    ...desktopCategories.map((c) => c.name),
  );
  const baseLanes = content.records.map((record) =>
    content.columns.indexOf(record.category),
  );
  slots = Array.from({ length: laneCount }, (_, lane) =>
    lane < 5
      ? baseLanes.flatMap((value, index) => (value === lane ? [index] : []))
      : [],
  );
  slotLanes = [...baseLanes];
  let extraIndex = 40;
  const assigned = new Map<number, RhineDocument>();
  for (let lane = 0; lane < laneCount; lane++) {
    const group = desktopCategories.find((c) => c.lane === lane);
    const docs = (
      lane === desktopNextLane
        ? rootDocs
        : documents.filter(
            (doc) =>
              group &&
              (groups
                ? doc.categoryId === group.id
                : doc.category === group.name),
          )
    ).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    while (slots[lane].length < Math.max(8, docs.length)) {
      slots[lane].push(extraIndex);
      slotLanes[extraIndex++] = lane;
    }
    docs.forEach((doc, row) => assigned.set(slots[lane][row], doc));
  }
  records.splice(
    0,
    records.length,
    ...Array.from({ length: extraIndex }, (_, index) =>
      recordFor(assigned.get(index), index),
    ),
  );
  canonicalSlots = new Map(
    records.map((_, index) => [fileLocation(index).slot, index]),
  );
}
export function exhibitDocument(id: string) {
  return records.findIndex((record) => record.id === id);
}
export function documentForRecord(index: number) {
  return desktopDocuments.find((doc) => doc.id === records[index]?.id);
}
export function displayCode(index: number) {
  const id = records[index].id;
  return /^X-\d+$/.test(id) ? Number(id.slice(2)) : index + 1;
}
export function columnFiles(lane: number) {
  return slots[lane] ?? slots[0];
}
export function fileLocation(index: number) {
  const lane = slotLanes[index] ?? 0;
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: row < 32 ? lane * 32 + row : 1000000 + index };
}
export function fileAtSlot(slot: number) {
  const canonical = canonicalSlots.get(slot);
  if (canonical !== undefined) return canonical;
  const files = columnFiles(
    ((Math.floor(slot / 32) % archiveColumns.length) + archiveColumns.length) %
      archiveColumns.length,
  );
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
