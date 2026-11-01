# 模型图片夹层验收

2026-11-01，版本 1.2.0-preview.1。更新源码与本地预览程序及 ZIP，不发布 Release。

## 改动

`src/model-images.ts` 中共享图片平面从 z=0.25 移至 z=0.17。实际两个 GLB 的磨砂盖板内表面为 z=0.174，最近内部刻线为 z=0.168。图片位于夹层，保留不透明 cutout、深度测试和物理透射采样；不增加渲染 pass、材质或逐帧工作。默认生成封面与自选图片、阵列、抽取与收回、查看器均复用这一位置。

## 检查

- TypeScript 全项目类型检查和 Vite 生产构建通过。
- 实际 GLB 几何验证与真实 WebGL 渲染通过；默认/自选图片分别对比磨砂和清晰状态。对比图左为修改前，右为修改后。
- 生成封面专项检查通过：自选优先、快照独立、过期纹理释放、有界缓存和失败队列继续执行。
- `check-decryption.mjs`、`check-assembly.mjs` 通过。
- 更新后的原路径程序启动正常；阵列、抽取详情、查看器清晰/磨砂切换、拆解和重组均通过，页面与渲染帧错误均为 0。
- 原知识库 88 个文件的逐文件哈希保持一致；验收造成的窗口尺寸偏好已恢复。实际客户端截图保留在 Git 忽略的 `local/notes/cover-layer-2026-11-01/`。
- ZIP 的 76 项文件逐项与运行目录核对通过，不含 RhineLabData。

## 交付

程序：`release/local-1.2.0-preview.1/RhineLab-win32-x64/RhineLab.exe`

ZIP：`release/local-1.2.0-preview.1/RhineLab-win32-x64-1.2.0-preview.1.zip`

ZIP SHA-256：`4dd8b985225a78a2541f6b3078ee0e5ebfc77b9cc266fa792cefa95701b6147f`

ASAR SHA-256：`a61b857b0a0478beeaab6694c07824ed5ae58085514befdfe121a6376dede9cd`

EXE、ASAR 版本均为 1.2.0-preview.1。1.0.0 与 1.1.0 归档未修改。

已逐个删除重复的候选 ASAR 和两份一次性验证脚本，释放 38,411,264 字节（36.63 MiB）。构建在内存完成，没有新增构建目录或测试客户端副本。保留源码、依赖、正式交付物和验收证据。
