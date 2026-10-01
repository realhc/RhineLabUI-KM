# AI 开发指引

## 目标与工作方式

本仓库只维护 Windows 本地 Markdown 知识库客户端。先读 README.md、本文、plan.md；涉及视觉继续读 DESIGN.md。以用户本次请求确定完成标准，先检查 Git 状态和实际发行包，保留无关未提交内容。

用户要求的正式功能在完成相关验证后可直接提交并同步到当前远程分支，不需重复确认。新实验、额外发布范围和破坏性操作仍按用户明确授权处理。不要引入未经请求的依赖、重构或功能。

沿用原生实现，不启用前端设计或动效 Skill 重做界面。若任务可并行，按独立文件或职责委派，避免互相覆盖。美术模型通过 Blender MCP 制作，保留生成脚本与源工程。

## 环境与入口

Node.js 至少 22.12，Windows PowerShell 使用 npm.cmd，其他平台可用 npm。工具路径来自当前运行环境，不能在源码或 README 固定某台机器的绝对路径。

- desktop/main.mjs：安全应用协议、窗口、IPC 与退出保护。
- desktop/preload.cjs：window.rhine 受限 API，不能覆盖该属性。
- desktop/repository.mjs、desktop/directory.mjs：Markdown 文件、分类、事务、回收与监控。
- src/desktop-entry.ts、src/desktop-main.ts：启动、阵列、详情、设置与图形恢复。
- src/scene.ts、src/model-viewer.ts：真实三维模型、材质、镜头与查看器。
- src/desktop-data.ts：动态分类与展陈映射；稳定文档 ID 与可见槽位分开。
- src/desktop.ts、src/desktop.css：知识库 DOM、功能区与布局。
- src/desktop-rich-editor.ts：排版编辑、选区、Markdown 序列化与文档独立撤销栈。
- src/desktop-library-motion.ts、src/desktop-directory.ts：界面生命周期与原生 scrollTop 惯性。
- scripts/prepare-desktop.mjs、scripts/desktop-resources.mjs、forge.config.cjs：离线资源、许可及打包白名单。

## 必须保持的产品行为

首页是完整三维终端，不恢复简化的小阵列或另设计一套首页。保持灯光、材质、阴影、AO、景深、循环、波浪与镜头规则；性能优化必须有保持画面的证据。抽取只作竖直升降，镜头负责构图；收回先转正再下降，背景档案不能为了留白额外沉降。

知识库由覆盖阵列的模糊玻璃与三块独立区域组成。左侧目录与右上功能区透明无底；主轴贯穿窗口，大小刻度共享轴心。样式限定在 #library-overlay，不污染全局按钮与主题。不要移动轴或文档行来制造动画；退场完成前保留输入隔离，关闭和数据更新停止旧动量，减少动态效果立即收束。

分类是大刻度，文档是小刻度。加号负责创建和命名；分类可折叠，文档整条可拖动归类/排序。分类与文档独立删除，删除分类保留文档。完整知识库没有固定 40 篇上限，删空后阵列仍存在。

阅读与编辑始终显示排版正文，不加入 Markdown 源码分栏。E 开始编辑，Ctrl+S 保存后继续编辑；切换文档恢复阅读。保留快捷键、选区格式、公式、表格、撤销隔离、草稿确认和外部冲突处理。

## 数据与安全边界

Markdown 文件是文档事实来源，localStorage 只保存偏好。按稳定 ID 定位，渲染进程不得传任意文件路径。保留原子写入、修订校验、事务恢复、回收区及符号链接/路径穿越保护；不能以修改时间缓存代替文件内容修订。

绝不删除、覆盖或打包真实 RhineLabData。测试复制程序并排除此目录，使用隔离配置和临时示例。同步多个工作副本时逐项核对来源及哈希，禁止整目录镜像覆盖个人数据。删除生成目录前核对其解析后的绝对路径位于目标项目中；不跨 shell 拼接删除命令。

保持 contextIsolation、sandbox、受限 IPC、CSP 和导航限制。外部 HTTP/HTTPS 链接交给系统浏览器；不能为了方便加载开启任意文件访问或 Node 集成。调试入口为 window.rhineReview，实际桥接为 window.rhine。

仓库不恢复独立站点入口、PWA、托管配置或壁纸宿主。Electron 开发时的 Vite 服务只服务客户端构建。保留原作者 LICENSE、字体版权和第三方声明；独立许可字体不随发行包分发。

## 验证与交付

先运行与改动有关的检查；静态内容修改不需要全套 GUI 回归，数据/启动/编辑变化必须检查实际客户端。以最终构建为准，不能只确认开发页面。

```powershell
npm.cmd run check:content
npm.cmd run check:desktop
npm.cmd run check:desktop:categories
npm.cmd run check:desktop:exhibit
npm.cmd run package:desktop
npm.cmd run check:desktop:package
npm.cmd run check:desktop:workflow
npm.cmd run check:desktop:recovery
npm.cmd run check:desktop:motion
node scripts/check-desktop-rich-editor.mjs
```

涉及场景时，与上一个发行程序在相同视口、时间、主题、画质和 DPI 下比较。不要降低视觉阈值来使失败通过。GUI 测试顺序执行，避免多个原生窗口相互遮挡。环境原生进程故障需与应用错误区分，保留实际日志；不得绕过权限或导出身份凭据。

Forge 的退出码不能单独证明打包完成。曾出现本机 Node 的 ZIP 解压流停在第一项、进程仍退出 0 的情况；系统原生解压验证缓存完整后才继续打包。交付前必须核对实际 EXE 文件版本、ASAR 白名单、ZIP 文件清单与 SHA-256，确认程序可启动；本地诊断工具不进入产品源码。

交付记录包含版本、修改范围、检查结果、当前程序/ZIP 相对路径、SHA-256 和个人数据保留情况。源码及用户教程及时更新；AI 实施说明写入本文，不塞进 README 用户流程。发布仅上传不含个人数据的便携 ZIP、校验清单及必要许可材料。

## 下一步开发顺序

1. 按实际问题继续覆盖不同显卡、多 DPI/显示器、睡眠恢复与只读目录，特别是启动/跳过开场和未保存编辑期间的恢复。
2. 图片附件、文档历史恢复或跨设备同步需要先确定用户需求与文件格式，再设计目录边界、迁移、冲突与恢复；不假定已经支持。
3. 在明确发布需求后考虑 Windows 签名和更新机制，保留便携目录及数据迁移能力。当前没有自动更新、云同步或安装器。
