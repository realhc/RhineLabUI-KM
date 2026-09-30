# 排版编辑与透明功能区验证

日期：2026-10-01。变更仅在桌面知识库中，网页入口、共享场景、阵列映射和仓库文件操作保持原有实现。

## 使用

整条文档均可拖入分类或拖动排序；目录边缘空白仍可拖动浏览，滚轮及键盘浏览保留。右上功能区透明无底，移除分类输入和源码／分栏／阅读切换。

文档默认阅读。点击编辑或按 E 可直接编辑排版内容；按钮变为保存，Ctrl+S 保存后继续编辑，查看另一篇文档恢复阅读。新文档自动进入编辑。工具栏提供一至四级标题与正文、粗体／斜体／下划线／删除线、链接、列表、引用、代码块及语言、表格和行列编辑、行内／独立 LaTeX、撤销／重做。

## 数据与实现

Tiptap / ProseMirror 管理选区和编辑事务，Markdown 扩展读写原有正文，KaTeX 随包离线渲染。只有实际修改正文才重新序列化 Markdown；进入编辑或无修改保存保留原文。下划线使用 ++，公式使用美元定界符。切换或重新载入文档隔离撤销历史，避免跨文档撤销。附件仍显示占位并保留引用，不发起图片请求；HTML 脚本保持文字且不执行。现有修订冲突、未保存提示、备份、分类、收藏和回收区沿用既有逻辑。

## 检查

- TypeScript 编译、Vite 桌面构建、Electron Forge 打包及 ZIP 生成成功。
- check-desktop-rich-editor.mjs：真实 Electron 的阅读／编辑状态、E 与 Ctrl+S、选区格式、全部标题级别、链接、代码、表格增删、公式修改与读写、原文保留、附件、撤销隔离、未保存取消／放弃、整条拖放、回收恢复、离线及重启。见 result.json。
- check-desktop-directory.mjs：目录滚轮、空白拖动、点击、键盘、整条排序、未保存保护和暗色小窗口。见 wheel-result.json。
- check-desktop-category-ui.mjs：分类创建命名、归类、折叠、独立删除、重启和空三维阵列。见 category-result.json。
- check-desktop-alignment.mjs：首页与网页基准布局一致、原场景、编辑保存、全文搜索、未保存保护、回收恢复、Node 隔离、离线、小窗口及空文档库。见 alignment-result.json。

浅色编辑与暗色小窗口阅读截图均来自实际客户端。测试只操作复制的隔离知识库。交付的 app.asar 与测试构建一致，便携 ZIP 内 app.asar 哈希一致且无用户数据；原客户端知识库交付前后全部文件哈希一致。见 delivery.json。退出并重新启动交付客户端生效。

开发参考：[Markdown 读写](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)、[公式扩展](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)。
