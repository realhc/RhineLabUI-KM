# 1.2.2 交付验收

2026-11-02。仅针对简介标题遮蔽、展开设置、开场名字字形与正式发布。

- 简介原生 ACCESS FILE 操作中，概述页签、面板标签和 Markdown 标题与正文共同遮蔽，墨块从 translateX(0%) 经中间值离开，结束后清理；关闭文档动态效果时直接显示。
- 动态 14 项、画质 9 项全部直接展示，没有 details/summary。切换动态选项无旧折叠状态错误。
- 默认字标 RHINE LAB 为 24px，实测字形宽约 164、高约 31.85，无 textLength 或 lengthAdjust；中文长名星河人工智能研究实验室完整展示，宽约 258.99、高约 29.27，不拉伸字形。主图标路径与 viewBox 不变。
- 现有解密与动态偏好检查、类型与生产构建通过。原路径 GUI 无页面/shader/帧错误，使用虚构档案截图。只核验本次变化，没有运行全套历史回归。
- 本地用户库 59 个文件逐项哈希不变，原始偏好和窗口字节已还原。
- ASAR 863 项读回；ZIP 76 项与运行目录逐文件 SHA-256 相同，7-Zip CRC 通过。无 RhineLabData、开发依赖或调试日志，EXE 内嵌完整性同步刷新。

[正式发布](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.2)。附件 RhineLab-win32-x64-1.2.2.zip，191683192 字节，以及 SHA256SUMS.txt。

ZIP SHA-256：`d7d98728397eb287f3a8e7036a32d4f350f30da91bd5a1ca2c4a95025eee751d`

ASAR SHA-256：`67fe130826168e93fa12f034c31bfcb855eb4bcaabd9c7d70509a23e903050c2`

临时助手、候选 ASAR/EXE 与状态快照逐项清理，释放 271.1 MiB。正式包、源码、依赖、用户数据与验收证据保留。
