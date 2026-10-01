# Windows 本地知识库

Rhine Lab 是 Windows 便携知识库客户端。程序、字体、模型、配乐和公式资源随包提供，使用时无需安装 Node.js、启动服务器或登录账户。

## 下载与启动

从本仓库 [Releases](https://github.com/realhc/RhineLabUI-KM/releases) 下载 Windows x64 ZIP，完整解压到当前用户可写目录，再运行 `RhineLab.exe`。只有 EXE 不能构成完整程序，`resources` 和其他运行文件也必须保留。

首次启动会创建 `RhineLabData` 并导入 40 篇示例档案。此后即使删空知识库，也不会再次自动导入。三维阵列始终存在；分类依次对应模型列，文档按目录顺序对应列内模型。分类数量和文档数量没有示例种子的限制。

## 知识库操作

点击 ARCHIVE INDEX 打开知识库。左侧目录保持贯穿客户端的主轴，滚轮或拖动空白处浏览；目录边的 ＋ 可创建并命名分类或文档。分类是大刻度，文档是小刻度。拖动整条文档可以归类或排序；有文档的分类可以折叠。删除分类会把文档保留到未分类，删除文档不删除分类。

右上是透明功能区，右下显示排版后的文档。点击“编辑”或按 E 开始编辑；Ctrl+S 或保存按钮保存后继续编辑，查看其他文档时恢复阅读。工具栏提供标题、文字格式、列表、链接、代码块、表格和 LaTeX 公式。未保存草稿在切文档、退出和外部变更时受到保护。

## 本地文件与备份

`RhineLabData` 位于程序旁，开发模式则位于项目根目录。

`documents/<稳定文档ID>.md` 是正文，`directory.json` 保存独立分类与目录关系，`.trash` 保存已移除文档，`backups` 保存写入前版本。标题改名不改变稳定文件名。程序设置及收藏迁移 JSON 不包含正文，完整迁移须复制整个数据目录。

可以用其他 Markdown 编辑器修改文档。客户端监听外部变化并提供刷新；有冲突时可保留草稿副本或重新载入磁盘版本，避免覆盖。删除先进入回收区，永久删除需要确认。知识库不接受符号链接或目录联接。

搬迁时先退出程序，再复制整个程序文件夹。更新时先备份 `RhineLabData`，替换程序运行文件并保留该数据目录。移除程序前单独保存知识库。

## 开发与检查

在项目根目录执行：

```powershell
npm.cmd ci
npm.cmd run dev:desktop
npm.cmd run check:desktop
npm.cmd run build:desktop
npm.cmd run package:desktop
```

开发依赖下载需要联网；完成打包后的客户端可离线使用。`check:desktop` 验证文件仓库，其他 UI 与恢复检查运行在程序的隔离副本中。最新发行验证见 [standalone](../verification/standalone/README.md)，开发约束见 [AGENT.md](../AGENT.md)。

资源署名与许可见 [DESKTOP-LICENSES.md](DESKTOP-LICENSES.md)。
