# 默认示例与编辑器演示

[archives.json](archives.json) 是空知识库首次初始化使用的只读种子，提供五个分类和四十篇稳定编号示例。用户的实际文档在 `RhineLabData` 中；修改这里不会覆盖已经初始化的个人知识库。

## 种子结构

- `categories` 和 `columns` 包含相同的五个分类，可有不同显示顺序。
- `records` 按 `X-001` 至 `X-040` 排列，每个种子分类八篇。编号应保持稳定。
- 标题、英文名、科室、日期、负责人、访问范围、摘要、研究记录和 HTTP/HTTPS 来源必须完整且非空。内容以 JSON 纯文本保存，客户端初始化时生成 Markdown 文档。

编辑 JSON 后运行 `npm.cmd run check:content` 和 `npm.cmd run build:desktop`。种子的五分类、四十篇约束只用于默认示例校验，实际知识库可以自由增减分类与文档。示例是基于公开设定的档案式改写，保留每篇的来源链接，不等同游戏原文。

## 富文本演示

`desktop-demos/` 提供五篇可选演示：快速上手、标题与字形、表格、代码和 LaTeX。在项目根目录运行 `node scripts/add-desktop-demos.mjs --root "RhineLabData目录"` 导入指定本地知识库。导入器不会覆盖同标题文档，也不会把回收区同标题演示重新导入；重复执行不会制造重复文档。

用户文档、备份与回收区不提交到 Git。
