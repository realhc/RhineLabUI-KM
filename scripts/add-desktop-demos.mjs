import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Repository } from "../desktop/repository.mjs";

const source = fileURLToPath(
  new URL("../content/desktop-demos/", import.meta.url),
);
const titleKey = (title) => title.trim().normalize("NFC").toLocaleLowerCase();

export async function addDesktopDemos(root) {
  if (!root) throw new Error("请用 --root 指定已初始化的 RhineLabData 目录。");
  const repository = new Repository(path.resolve(root));
  await repository.safe(path.join(repository.root, ".initialized"));
  if (!(await fs.stat(path.join(repository.root, ".initialized"))).isFile())
    throw new Error("请先运行客户端初始化知识库。");
  const files = (await fs.readdir(source))
    .filter((name) => /^演示\d+-.*\.md$/.test(name))
    .sort();
  const initial = await repository.list();
  const known = new Set(
    [...initial.documents, ...initial.trash].map((doc) => titleKey(doc.title)),
  );
  const pending = [];
  const skipped = [];
  for (const file of files) {
    const title = path.basename(file, ".md");
    if (known.has(titleKey(title))) {
      skipped.push(title);
      continue;
    }
    const body = await fs.readFile(path.join(source, file), "utf8");
    repository.validateInput({ title, category: "编辑器演示", body });
    pending.push({ title, body });
  }
  let category = initial.categories.find(
    (group) => group.name === "编辑器演示",
  );
  const created = [];
  if (pending.length) {
    category ??= await repository.createCategory("编辑器演示");
    for (const item of pending)
      created.push(
        await repository.create({
          ...item,
          category: category.name,
          categoryId: category.id,
        }),
      );
  }
  const final = await repository.list();
  for (const old of [...initial.documents, ...initial.trash]) {
    const now = [...final.documents, ...final.trash].find(
      (doc) => doc.id === old.id,
    );
    if (!now || now.revision !== old.revision)
      throw new Error("导入期间原文档发生外部变化，请检查：" + old.title);
  }
  return {
    root: repository.root,
    category: category?.name ?? "编辑器演示",
    created: created.map((doc) => ({ id: doc.id, title: doc.title })),
    skipped,
    existingDocumentsUnchanged: true,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const index = process.argv.indexOf("--root");
  try {
    if (index < 0 || !process.argv[index + 1])
      throw new Error(
        '用法：node scripts/add-desktop-demos.mjs --root "客户端旁的 RhineLabData 路径"',
      );
    console.log(
      JSON.stringify(await addDesktopDemos(process.argv[index + 1]), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
