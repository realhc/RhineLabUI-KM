# 排版编辑与透明功能区验收

2026-10-01 的实际客户端记录。整条文档可拖入分类，右上功能区透明无底；正文保持排版阅读。E 进入编辑，Ctrl+S 保存后继续编辑，切换文档恢复阅读。

工具栏覆盖一至四级标题、正文、字形、链接、列表、引用、代码块、表格、LaTeX 与撤销重做。Tiptap / ProseMirror 管理选区与编辑事务，只有实际修改才重新序列化 Markdown；切换文档隔离撤销历史。

[result.json](result.json) 保存真实 Electron 的编辑状态、快捷键、格式、表格公式、原文保留、附件、撤销隔离、草稿保护、整条拖放、回收与重启结果。[category-result.json](category-result.json) 与 [wheel-result.json](wheel-result.json) 保存分类与目录检查。截图来自实际客户端，测试知识库均为隔离副本。
