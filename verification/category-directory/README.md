# 分类刻度目录验证

2026-10-01 的客户端检查记录。分类是大刻度，文档是小刻度；支持创建命名、整条拖放归类、折叠、改名与独立删除。分类列号持续分配，额外分类和单列 35 篇文档有独立阵列位置；删空知识库后阵列继续渲染。

实际客户端检查结果见 [ui-result.json](ui-result.json) 和 [wheel-result.json](wheel-result.json)，浅色和暗色小窗口截图随目录保留。仓库单元检查由 scripts/check-desktop-categories.mjs 与 check-desktop-exhibit.mjs 覆盖；当前工作流与启动恢复使用独立桌面检查。

测试只操作隔离副本，个人知识库不参与测试。
