# Changelog

本文件由 `scripts/release.mjs` 自动维护（`npm run release <patch|minor|major>`）。

## [1.8.32] - 2026-08-23

### 更新内容

- feat: CAD 停滞快速失败与恢复 + 工具分类/服务化等多项整理 (1a4be01)
- fix: tests/cad.test.js 平台依赖修复——connect 相关测试在非 Windows 平台强制 win32 平台标志
- chore: 测试基建（vitest.config.js + 覆盖率）、构建脚本抽取、eslint 强制化、发布流程
