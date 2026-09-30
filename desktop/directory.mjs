import { randomUUID, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
const fail = (code, message) => Object.assign(new Error(message), { code });
const idOK = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id);
const nameOK = (name) =>
  typeof name === "string" && name.trim() && name.length <= 200;
export class Directory {
  constructor(repository) {
    this.repo = repository;
    this.file = path.join(repository.root, "directory.json");
  }
  async load(result) {
    await this.repo.safe(this.file, true);
    try {
      const stat = await fs.stat(this.file);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
        throw fail("FORMAT", "分类目录文件异常。");
      const raw = await fs.readFile(this.file, "utf8"),
        value = JSON.parse(raw);
      if (
        value.version !== 1 ||
        !Array.isArray(value.categories) ||
        !value.assignments ||
        typeof value.assignments !== "object" ||
        Array.isArray(value.assignments) ||
        !Number.isSafeInteger(value.nextLane) ||
        value.nextLane < 0 ||
        value.nextLane > 10000
      )
        throw fail("FORMAT", "分类目录格式无效。");
      const ids = new Set(),
        names = new Set(),
        lanes = new Set();
      for (const c of value.categories) {
        if (
          !idOK(c.id) ||
          !nameOK(c.name) ||
          !Number.isSafeInteger(c.lane) ||
          c.lane < 0 ||
          c.lane >= value.nextLane ||
          ids.has(c.id) ||
          names.has(c.name) ||
          lanes.has(c.lane)
        )
          throw fail("FORMAT", "分类信息重复或无效。");
        ids.add(c.id);
        names.add(c.name);
        lanes.add(c.lane);
      }
      for (const [id, group] of Object.entries(value.assignments))
        if (!idOK(id) || (group !== null && !ids.has(group)))
          throw fail("FORMAT", "文档分类关联无效。");
      return {
        value,
        revision: createHash("sha256").update(raw).digest("hex"),
      };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    result ??= (await this.repo.scan()).result;
    const names = [
      ...new Set(
        [...result.documents, ...result.trash]
          .map((d) => d.category)
          .filter((n) => n && n !== "未分类"),
      ),
    ];
    const preferred = this.repo.sampleColumns ?? [];
    names.sort((a, b) => {
      const x = preferred.indexOf(a),
        y = preferred.indexOf(b);
      return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
    });
    const categories = names.map((name, index) => ({
      id: randomUUID(),
      name,
      lane: preferred.includes(name)
        ? preferred.indexOf(name)
        : Math.max(preferred.length, 0) +
          names.slice(0, index).filter((n) => !preferred.includes(n)).length,
    }));
    const value = {
      version: 1,
      nextLane: Math.max(5, ...categories.map((c) => c.lane + 1)),
      categories,
      assignments: Object.fromEntries(
        [...result.documents, ...result.trash].map((d) => [
          d.id,
          categories.find((c) => c.name === d.category)?.id ?? null,
        ]),
      ),
    };
    await this.repo.atomic(
      this.file,
      JSON.stringify(value, null, 2) + "\n",
      null,
    );
    return this.load();
  }
  async change(action) {
    const { value, revision } = await this.load();
    await action(value);
    await this.repo.atomic(
      this.file,
      JSON.stringify(value, null, 2) + "\n",
      revision,
    );
    return value;
  }
  member(value, doc) {
    return Object.hasOwn(value.assignments, doc.id)
      ? value.assignments[doc.id]
      : (value.categories.find((c) => c.name === doc.category)?.id ?? null);
  }
  async decorate(result) {
    const { value } = await this.load(result);
    for (const group of ["documents", "trash"])
      result[group] = result[group].map((d) => {
        const categoryId = this.member(value, d),
          c = value.categories.find((c) => c.id === categoryId);
        return { ...d, categoryId, category: c?.name ?? "未分类" };
      });
    return {
      ...result,
      categories: value.categories.map((c) => ({ ...c })),
      nextLane: value.nextLane,
    };
  }
  async assign(id, name, categoryId) {
    return this.change((value) => {
      let c;
      if (categoryId !== undefined) {
        if (
          categoryId !== null &&
          !value.categories.some((g) => g.id === categoryId)
        )
          throw fail("NOT_FOUND", "分类已被移除。");
        value.assignments[id] = categoryId;
        return;
      }
      name = name?.trim();
      if (name && name !== "未分类") {
        c = value.categories.find((g) => g.name === name);
        if (!c) {
          if (!nameOK(name)) throw fail("INPUT", "分类名称无效。");
          c = { id: randomUUID(), name: name.trim(), lane: value.nextLane++ };
          value.categories.push(c);
        }
      }
      value.assignments[id] = c?.id ?? null;
    });
  }
}
