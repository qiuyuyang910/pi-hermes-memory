# 源码来源与适配范围

- 上游：<https://github.com/chandra447/pi-hermes-memory>
- 版本：本机安装的 pi-hermes-memory 0.9.10。
- 取得位置：`C:/Users/秋雨样/.pi/agent/npm/node_modules/pi-hermes-memory`。
- 许可证：MIT，原文保留在 `vendor/hermes/LICENSE`，原版包清单保留在 `vendor/hermes/package.json`。
- 基线：复制原版 `src/`，未复制依赖、脚本、测试、凭据或记忆数据。原版逐文件 SHA-256 记录见 `UPSTREAM-FILES.sha256`，可用于复核适配差异。
- 上游基线已与官方 `v0.9.10` 的 `df624056a2e8c68bc89ba0a81e1c120856ec9665` 核对，59 个文件内容一致，差异仅为 CRLF/LF。`hermes-upstream` 保存未经角色适配的源码，`roles-hermes` 从该基线恢复既有适配，后续可三方合并。详细记录与更新步骤见 `UPSTREAM.md` 和 `UPSTREAM-UPDATE.md`。

新增 `src/` 管理角色定义、会话归属、模型与工具选择，以及 `createHermesRuntime`。vendor 源码保留原版工具、命令和存储实现，适配实例路径上下文、角色项目标识、实例实时索引状态、归属数据库的手动索引、关闭等待及 direct-only 后台调用。关闭旧数据自动迁移和依赖自动重建，避免修改原安装目录或移动原记忆。

依赖使用原版 better-sqlite3、strip-ansi，并将运行时使用的 typebox 明确列入根包 dependencies。首版主机契约为 Pi 1.0.2；其他版本尚未验证。静态核查不证明加载、模型调用、原生数据库兼容性或隔离的运行时行为。
