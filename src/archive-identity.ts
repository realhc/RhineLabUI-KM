export type ArchiveIdentitySource = { id: string; category?: string };

/** Stable visual seed only. The original document ID remains the data identity. */
export function archiveSeed(value: string) {
  let seed = 2166136261;
  for (const character of value.normalize("NFC")) {
    seed ^= character.codePointAt(0)!;
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

const marks = ["◇", "□", "△", "○", "⬡"] as const;

/** One identity vocabulary shared by directory, reader, graph and cover print. */
export function archiveIdentity(document: ArchiveIdentitySource) {
  const category = document.category?.trim() || "未分类";
  const id = document.id;
  return {
    code: id.length <= 18 ? id : id.slice(0, 8) + "…" + id.slice(-4),
    mark: marks[archiveSeed(category) % marks.length],
    category,
  };
}
