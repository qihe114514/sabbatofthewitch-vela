# 立绘与表情同画布阅读器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新提取本体与补丁资源，并让阅读器以同一画布精确叠加身体和表情。

**Architecture:** 提取器先按 XP3 归档优先级合并文件，再把脚本和图像交给运行时资源生成器。生成器以原作层元数据生成同画布 body/face PNG 与精确角色键映射；阅读器只渲染 portrait 记录。

**Tech Stack:** Python 3、Pillow、Node.js、Xiaomi Vela UX、aiot-toolkit。

## Global Constraints

- 手环运行时图片只能是 PNG。
- 角色映射键固定为 `角色|表情|服装`，禁止按角色名猜图。
- 表情和身体必须共享源画布、裁剪矩形与缩放比例。
- release 产物写入 `E:/Vibe Coding/miband/魔女的夜宴/RPK`。

---

### Task 1: 补丁优先级提取

**Files:**
- Modify: `提取工具/extract_visual_archives.py`
- Test: `环9Pro/tests/resource-tools.test.js`

- [ ] 添加 `--archives` 默认列表，包含本体视觉/剧本归档和 `patch.xp3` 到 `patch4.xp3`。
- [ ] 将所有条目按归档顺序写入同一合并目录，后写入的补丁覆盖同名本体路径。
- [ ] 输出 `archive-priority.json`，保留每个文件的来源归档。

### Task 2: 同画布角色生成

**Files:**
- Modify: `环9Pro/tools/build-runtime-assets.py`
- Modify: `环9Pro/tools/validate-scn.js`
- Test: `环9Pro/tests/resource-tools.test.js`

- [ ] 角色生成同时写出 body/face 的 canvas、crop、sourceKey 元数据。
- [ ] 没有精确 body 的角色键不生成 face，也不回退到其他角色。
- [ ] 所有输出图像和 manifest 路径统一 `.png`。

### Task 3: portrait 阅读器

**Files:**
- Modify: `环9Pro/src/common/resource-resolver.js`
- Modify: `环9Pro/src/pages/detail/detail.ux`
- Modify: `环9Pro/src/pages/detail/scriptEngine.js`

- [ ] resolver 返回可验证的 portrait 记录。
- [ ] detail 页面每个位置只渲染一个 portrait 容器，body 与 face 使用同一容器尺寸。
- [ ] 清理旧的独立 face 缓存和不精确的视觉回退。

### Task 4: 全量验证和 release

**Files:**
- Modify: `环9Pro/package.json`
- Modify: `环9Pro/src/manifest.json`

- [ ] 从原作目录提取并生成运行时资源。
- [ ] 运行 `npm run check` 与 `npm test`。
- [ ] 运行构建、RPK 校验和 `npm run release`，把 release 复制到指定 `RPK` 目录。
