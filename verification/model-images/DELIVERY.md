# 模型自定义图片交付记录

日期：2026-10-25。客户端版本：1.3.0，本次独立模型图片试用构建，未改变项目版本号。

仅新增按文档绑定的模型图片：在知识库选择文档，使用“模型图片”添加或替换 PNG/JPEG，使用“移除图片”恢复原模型。图片保持比例，显示于阵列、抽取详情及 360° 查看器，重启后保留。图片复制到 `RhineLabData/assets/model-images/`，正文文件头只记录内容哈希引用。

源码已按 13 个文件的哈希白名单回写。未修改依赖、模型资源、原材质与灯光参数、镜头、动效或 AI 功能。原有未提交文件保留，原便携程序和真实 RhineLabData 未覆盖。

验证结果：

- 最终 TypeScript/Vite 构建通过。
- `npm.cmd test` 全部通过，包括新增图片仓库检查及原内容、文件仓库、分类、展陈映射和打包资源检查。
- 最终便携程序 GUI 测试通过：PNG/JPEG 导入与缩放、取消和无效文件保护、草稿保护、重复阵列图片、详情与查看器实际像素、拆解、替换与切换、重启保存、回收恢复和移除。没有页面异常或 HTTP 请求，详见 `result.json`。
- 无图片画面对比使用相同视口 1440×900、DPI 1、默认画质及减少动态效果；测试工具固定 SSAO 噪声以比较独立启动。两种主题的模型与镜头状态相同。浅色 1,296,000 像素完全一致；深色仅 2 个像素相差最多 1 级色值，因此严格逐像素全等检查记为 false，未放宽阈值。详见 `no-image-comparison.json`。
- EXE 文件版本为 1.3.0。ASAR 包含 873 个条目，ZIP 包含 76 个条目；均不含个人数据、node_modules 或本机诊断工具。ZIP 内 ASAR 与测试程序的 ASAR 哈希一致；交付副本的 EXE/ASAR 与实测构建哈希一致。

项目相对路径：

- 程序：`release/model-images-preview/RhineLab-win32-x64/RhineLab.exe`
- 压缩包：`release/model-images-preview/RhineLab-win32-x64-1.3.0-model-images.zip`
- 校验文件：`release/model-images-preview/SHA256SUMS.txt`

ZIP SHA-256：`a025f7ae966bda23a9612d5f869b32989f7a558c871012bab42dd96122e23ff0`

EXE SHA-256：`eaf15005d71157d559acca86b041b123980dd9bcf1f1b26400b63946c75d5766`

ASAR SHA-256：`6ceee687e82d9c072772f8de7b316e0b67603b8d8bb61c9e09f9f054731c7466`
