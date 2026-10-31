export type HistoryDifference = { kind: "same" | "removed" | "added"; text: string };
export type HistoryComparison = { lines: HistoryDifference[]; truncated: boolean };

const MAX_ROWS = 3000, MAX_LINE_CHARACTERS = 4096, MAX_CHARACTERS = 256 * 1024;

function boundedResult(lines: HistoryDifference[], truncated = false): HistoryComparison {
  // Bound browser layout as well as the line-diff matrix. A single valid line
  // may contain megabytes; retain both ends and explicitly report omissions.
  const allowance = Math.floor(MAX_CHARACTERS / Math.max(1, lines.length));
  const limit = Math.min(MAX_LINE_CHARACTERS, allowance);
  return {
    lines: lines.slice(0, MAX_ROWS).map(row => {
      if (row.text.length <= limit) return row;
      truncated = true;
      const half = Math.floor((limit - 1) / 2);
      return { ...row, text: row.text.slice(0, half) + "…" + row.text.slice(-half) };
    }),
    truncated: truncated || lines.length > MAX_ROWS,
  };
}

/** Bounded line comparison. Large documents use a changed span with nearby context. */
export function compareHistory(current: string, historical: string): HistoryComparison {
  const before = current.replace(/\r\n/g, "\n"), after = historical.replace(/\r\n/g, "\n");
  if (before === after) return { lines: [], truncated: false };
  // Limit even the initial split: a valid 15 MB note may contain millions of lines.
  const a = before.split("\n", 1601), b = after.split("\n", 1601);
  if (a.length * b.length > 160000 || a.length + b.length > 1600) {
    let prefix = 0, suffix = 0;
    const shortest = Math.min(before.length, after.length);
    while (prefix < shortest && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
    while (suffix < shortest - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
    const start = before.lastIndexOf("\n", prefix - 1) + 1;
    const endOfLine = (text: string, position: number) => {
      const end = text.indexOf("\n", position);
      return end < 0 ? text.length : end + 1;
    };
    const beforeEnd = endOfLine(before, before.length - suffix), afterEnd = endOfLine(after, after.length - suffix);
    const result: HistoryDifference[] = [];
    let truncated = false;
    const append = (text: string, from: number, to: number, kind: HistoryDifference["kind"], limit: number, changed = false) => {
      let count = 0;
      while (from < to && count++ < limit) {
        const newline = text.indexOf("\n", from), end = newline < 0 || newline >= to ? to : newline;
        result.push({ kind, text: text.slice(from, end) }); from = end + 1;
      }
      if (changed && from < to) truncated = true;
    };
    let context = start;
    for (let i = 0; i < 3 && context > 0; i++) context = before.lastIndexOf("\n", context - 2) + 1;
    append(before, context, start, "same", 3);
    // Reserve half of the view for each side so a large deletion does not hide
    // all of the selected historical content.
    append(before, start, beforeEnd, "removed", 1497, true);
    append(after, start, afterEnd, "added", 1497, true);
    append(before, beforeEnd, before.length, "same", 3);
    return boundedResult(result, truncated);
  }
  const width = b.length + 1, grid = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    grid[i * width + j] = a[i] === b[j] ? grid[(i + 1) * width + j + 1] + 1 : Math.max(grid[(i + 1) * width + j], grid[i * width + j + 1]);
  const result: HistoryDifference[] = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: "same", text: a[i++] }); j++; }
    else if (i < a.length && (j === b.length || grid[(i + 1) * width + j] >= grid[i * width + j + 1])) result.push({ kind: "removed", text: a[i++] });
    else result.push({ kind: "added", text: b[j++] });
  }
  return boundedResult(result);
}
