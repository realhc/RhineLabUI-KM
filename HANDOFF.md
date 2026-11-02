# 维护交接

## 本轮目标与交付状态

本轮目标为正式 **1.2.3**：首次启动只填写用户名，存为本机偏好，替换终端中的固定身份；公共发行包不预置用户名。维护者指定的本机身份只写入本地设置。另更新 README，并在 1.2.3 成功发布后移除 1.2.2 Release；源码标签、历史验收和本地 ZIP 保留。

<!-- RELEASE_STATUS_BEGIN -->
源码、Windows EXE 与 ASAR package 均为正式 **1.2.3**。实际程序为 `release/v1.2.3/RhineLab-win32-x64/RhineLab.exe`，公开附件为同版本目录下的 `RhineLab-win32-x64-1.2.3.zip` 与 `SHA256SUMS.txt`。ZIP SHA-256：`32de1e923e10fa2000aa93db5ba6d39d565769d8933e0fa9dc44bc7369b49f8a`。

首次填写、空值拒绝、重启记忆、设置改名、页脚和访问日志均通过最终程序验收。本机指定用户名已通过首启表单保存并重启确认，仅留本地偏好；公共包无用户名预设。59 个真实数据文件哈希一致，56 篇文档与 15 类资料保留，其他偏好和窗口字节恢复。两个模型 GLB 未变，ZIP 76 项逐项匹配运行目录且 CRC 通过。仅执行本轮相关检查。

已发布最新正式版 [v1.2.3](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.3)，远程附件摘要与本地一致。1.2.2 Release 已移除；旧标签与本地 ZIP 保留。 验收记录见 [本轮交付记录](verification/release-1.2.3/DELIVERY.md)。
<!-- RELEASE_STATUS_END -->

目标程序目录为 `release/v1.2.3/RhineLab-win32-x64/`，附件为 `RhineLab-win32-x64-1.2.3.zip` 和 `SHA256SUMS.txt`。最终版本状态以 [VERSIONS.md](docs/VERSIONS.md) 与对应 `verification/` 验收记录为准，历史流水见 [交接归档](docs/HANDOFF-HISTORY-2026-11-02.md)。

## 已有功能与本地数据

客户端为 Windows 便携 Electron 应用，入口保留完整三维终端，知识库以 Markdown 为事实来源。已具备分类/手动排序/回收区、富文本与公式/表格、模型与正文图片、阅读导航、全局/局部图谱与反向引用、历史比较/恢复、生成封面、模型配色/镀层和可选 AI。设置分为通用、外观、声音、动态、画质、数据；动态 14 项与画质 9 项始终展示。

本机此前安装了 50 篇 AI 文档（10 类各 5 篇）和 6 篇教程，共 56 篇、15 类；升级时按实际库清单核对，不能用示例库覆盖。原有 45 篇活动文档及完整历史/回收区保存在忽略目录 `local/data-backups/before-ai-1.2.1-20261101`。安装记录和首启样本位于 `local/notes/ai-library-1.2.1/`、`local/notes/onboarding-1.2.1/`。这些内容与真实 `RhineLabData` 均不进入 Git 或发布附件。

全新空目录仅首次导入 `content/archives.json` 中的 6 篇教程；已初始化的库删空后不重灌。用户名、应用内名称、收藏和外观属于本机设置，与 Markdown/图片分开迁移；设置导入采用严格字段校验并兼容旧文件。应用内名称不改变 EXE、系统窗口名或发行包名。

## 主要入口

| 范围 | 入口 |
| --- | --- |
| 启动、身份、偏好和开场 | `desktop-entry.ts`、`desktop-main.ts`、`local-user.ts`、`local-user-gate.ts`、`local-user.css`、`startup.ts`、`boot.ts`、`app-name.ts`、`preferences-transfer.ts` |
| 文件与编辑 | `desktop/repository.mjs`、`directory.mjs`、`preload.cjs`；`src/desktop.ts`、`desktop-rich-editor.ts` |
| 阅读、关系与历史 | `desktop-reading.ts`、`desktop-graph-data.ts`、`desktop-relations.ts`、`desktop-history.ts` |
| 阵列、查看器、图片与外观 | `scene.ts`、`model-viewer.ts`、`model-images.ts`、`model-look*`、`archive-cover.ts`、`archive-patterns.ts` |
| 可选 AI | `desktop/ai-runtime.mjs` 及 service/tools/automation/http 模块，界面 `src/desktop-ai.ts` |
| 资源与发行 | `vite.config.ts`、`scripts/prepare-desktop.mjs`、`desktop-resources.mjs`、`forge.config.cjs` |

未标前缀的前端文件均在 `src/`。详细模块地图见 [开发说明](docs/DEVELOPMENT.md)，维护边界见 [AGENT.md](AGENT.md)，按改动选取 [检查入口](tests/README.md)。

## 必须保留的约束

- **模型结构与全部尺寸不变。** 保留灯光、透射、阴影、AO、景深及镜头规则；抽取只作竖直升降，收回先转正再下降。40 个基础槽位独立于教程数量，知识库没有 40 篇上限。图片窗口仍为 2.65×3.05、z=0.17，处于磨砂盖板内侧；不引入干涉版画。
- 模型外观只更新现有 shader uniform/共享实例颜色缓冲；按稳定文档 ID 配色，优先级为单篇指定色、收藏色、全局色，强度沿用全局。全局恢复默认保留单篇色。扩容、返回副本、图形恢复与异步查看器均须同步，标签/图片不染色，缓存有界、空闲不额外重绘。
- 知识库保留玻璃、目录、功能区、正文三块布局；样式限定作用域。正文阅读与编辑共用排版，不增源码分栏，不破坏选区或文档独立撤销。导航经过 `canLeave()`，滚动目标是 `#panes`；图谱不销毁编辑器。标题与网格装饰位于 `.tiptap` 外。
- 保留稳定 ID、原子写入、修订冲突、回收与路径/符号链接防护。历史恢复同时校验备份名/内容哈希与当前 revision，先备份被替换版本。正文图片用标准相对引用，模型图片独立存放；异步插入用 transaction mapping，保存/离开等待导入，旧异步结果及时丢弃和释放。
- 保持 `sandbox`、`contextIsolation`、受限 IPC/CSP，关闭 Node 集成。文档与工具输出是非可信材料，不能授予路径、shell 或写权限。AI 失败不影响基础客户端，默认只读，修改需最新 revision 且无未保存草稿；密钥仅在主进程用 `safeStorage` 保存。定时任务只在程序运行时执行，关闭期间错过的任务最多补跑一次，保留运行标识防重复。

## 构建与发布的最小流程

1. 先检查 Git 差异，确认本轮范围。只运行改动相关检查；小修复不跑全套历史回归。启动/编辑/数据变化需在最终发行程序检查实际路径，GUI 顺序执行，用隔离数据或内存夹具（IPC 返回 `{ok:true,value:...}`）。
2. 在修改偏好或启动验收前持久保存原始 localStorage、`window.json` 字节与真实库哈希，跨重试复用快照。入口先 `await ensureLocalUser()`，首次用户名表单出现在 `rhineReview`/终端加载之前，因此必须在表单提交前保存偏好，再填通用测试名并等待 ready；不能照旧等 ready 才取快照。终端 ready 后才重载夹具，按 startup 状态处理进入按钮。公共截图使用示例用户，本机指定身份只留本地偏好。开场截图等加载遮罩退出，简介截图等面板可见；验收后恢复偏好与窗口字节并核对整库。
3. 最后一次源码变更后再构建。核对源码/锁文件、ASAR package 与 Windows EXE 版本、运行资源白名单、两个 GLB 字节、ZIP 每项与运行目录的哈希及 CRC。刷新 EXE 中的 ASAR 完整性；公共包排除用户数据、用户名/偏好、调试日志和私有字体。Forge 成功退出本身不代表交付成功。
4. 提交前固定作者 `realhc <realhc@users.noreply.github.com>`（或账号已验证邮箱）、`user.useConfigOnly=true`；AI 仅为 `Co-authored-by: Codex <noreply@openai.com>`。推送前用 `git log -3` 核对 author/committer，不改写已推送历史。
5. 推送源码与正式标签，创建草稿并上传干净 ZIP/清单；核对远程附件摘要后公开为最新正式版。PowerShell 中 Git 的 ^{commit} 等 revision 参数需加引号，避免被当成语法解析。`target_commitish` 使用完整 SHA，短 SHA 曾返回 422。新版本成功后，才逐个移除用户明确指定的旧 Release，不顺带删除源码标签或本地归档。
6. 更新当前交接与验收记录。只清理已确认可丢弃的候选包、一次性助手、快照和中间输出，**一次只删除一个明确路径**；先核对绝对路径和链接，不跟随 junction，不批量删除或镜像覆盖知识库。保留源码、依赖、正式包、证据和备份，报告清理范围、释放空间及残留。

本机 Windows 默认只有工作区可写，修改 E 盘项目需使用已授权的提权工具，不重复询问已获授权的任务。Node.js 至少 22.12；PowerShell 用 `npm.cmd`，不是被策略阻止的 npm.ps1。缺依赖时先复用本机版本匹配的完整工作副本，不更改产品依赖；Vite 保留 ESM import 条件，不能一律按 CommonJS 入口解析。

## 已确认的关键踩坑

- Windows ASAR 查询路径须原生规范化；`createPackageFromStreams` 返回后还要等待写流完成再读回。既有便携 ZIP 条目位于根目录并使用反斜杠，更新前先检查实际清单。
- 本机 V8 曾报 `unsupported opcode`，构建工具可临时用 `node --no-opt`；Electron ZIP 曾静默解压不全，需核验精确缓存、原生解压和最终清单。Low 完整性标签曾导致 `0x80000003`，应修复标签，不放宽 Electron 安全设置。
- 简介遮蔽覆盖页签、面板标签与 Markdown 各级标题，复用 0.95s 进度；页签的通用 span 边距会偏移遮罩。动态/画质已无 details，不能残留 `.open` 读写；滚动恢复针对 `.settings-content`。
- 开场字标不使用 `spacingAndGlyphs` 拉伸，逐字时保留节点；只在构造/字体就绪时拟合完整名称。身份文字从统一用户名来源取得，固定字形不应重新显示旧身份。
- 图片/封面任务成功或失败释放槽位后均要通知场景，避免空闲渲染把队列卡住。查看器异步完成后应用最新外观；返回副本 clone 后重新建立独立 uniform，再按旧文档 ID 赋色。

更细的阅读网格、图片安全和历史恢复经验保留在 [历史归档](docs/HANDOFF-HISTORY-2026-11-02.md)。历史验收的路径、版本号和哈希不要全局替换。

## 后续建议（按优先级）

1. **明确身份与偏好的迁移范围。** 用户名和应用内名称保持两个概念，设置页及导入/导出教程使用一致称呼。若将来支持多知识库或多人共用，先确定偏好按电脑、知识库还是个人保存；当前用户名只用于本机显示，不隐式变成权限账户。
2. **收敛发布步骤和少量固定验收。** 将已反复验证的版本同步、资源排除、ASAR/EXE 完整性、附件摘要核对整理为可复用发布脚本，保留首次用户名、ACCESS FILE 标题、设置页这类直接覆盖近期改动的少量检查，减少一次性助手与无关全量测试。
3. **按分发需求决定签名、更新和同步。** 当前尚无 Windows 签名、自动更新或跨设备同步。只有明确需要后再实施；更新需保护便携库，跨设备需先定义 Markdown 冲突、偏好归属和密钥迁移方式。
