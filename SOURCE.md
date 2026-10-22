# 源码来源与适配范围

- 上游：<https://github.com/chandra447/pi-hermes-memory>
- 版本：当前基于官方 pi-hermes-memory v0.9.11（`71cf5ab7d909318a383bf52bb3ad3cf83a9efc03`）；首版使用本机安装的 0.9.10。
- 取得位置：首版为 `C:/Users/秋雨样/.pi/agent/npm/node_modules/pi-hermes-memory`；本次从官方仓库下载固定提交源码，临时快照保存在被忽略的 `.state/hermes-import/`。
- 许可证：MIT，原文保留在 `vendor/hermes/LICENSE`，原版包清单保留在 `vendor/hermes/package.json`。
- 基线：保留原版 `src/`、许可证和包清单的来源，不导入依赖、脚本、测试、凭据或记忆数据。`UPSTREAM-FILES.sha256` 记录当前 v0.9.11 纯快照的 57 个源码文件哈希，可用于复核适配差异。
- 初始源码曾与官方 `v0.9.10` 的 `df624056a2e8c68bc89ba0a81e1c120856ec9665` 核对。本次以该版本为 base、当前工作区为 ours、固定 v0.9.11 为 theirs 合并内容；`hermes-upstream` 仍停留在 0.9.10，本次没有提交或推进该分支。详细记录与更新步骤见 `UPSTREAM.md` 和 `UPSTREAM-UPDATE.md`。

新增 `src/` 管理角色定义、会话归属、模型与工具选择，以及 `createHermesRuntime`。vendor 源码保留原版工具、命令和存储实现，适配实例路径上下文、角色项目标识、实例实时索引状态、归属数据库的手动索引、关闭等待及 direct-only 后台调用。关闭旧数据自动迁移和依赖自动重建，避免修改原安装目录或移动原记忆。

依赖使用原版 better-sqlite3、strip-ansi，并将运行时使用的 typebox 明确列入根包 dependencies。首版主机契约为 Pi 1.0.2；其他版本尚未验证。静态核查不证明加载、模型调用、原生数据库兼容性或隔离的运行时行为。
