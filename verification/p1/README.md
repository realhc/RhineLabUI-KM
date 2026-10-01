# 分类与编辑工作流验收

2026-10-01 的客户端功能记录。动态分类、独立删除、文档归属、单列 35 篇文档、空阵列和重启由分类与展陈检查覆盖。结果见 [category-result.json](category-result.json)。

[workflow-result.json](workflow-result.json) 覆盖外部修改时保留草稿、另存副本、重新载入、外部删除后的草稿保护、排序前保存或取消、重启后稳定 ID 与顺序、正文键盘隔离和窗口关闭保护。[rich-editor-result.json](rich-editor-result.json) 保存完整富文本检查。

原生对话框检查注入选择返回值，不代表人工点击 Windows 对话框。检查复制客户端到独立目录并排除真实 RhineLabData。可在打包后运行 npm.cmd run check:desktop:p1 或 check:desktop:workflow。最新发行记录见 [standalone](../standalone/README.md)。
