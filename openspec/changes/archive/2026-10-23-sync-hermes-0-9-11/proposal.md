# Proposal

## Why

当前角色插件基于 Hermes 0.9.10，上游 0.9.11 已修复扩展 provider 的 direct 调用、provider 错误被误报为解析失败、多行记忆的项目归属解析和跨平台临时会话清理等问题。同步固定发行版，同时保留角色隔离、后台 direct-only 和工作区已有的诊断日志改动。

## What Changes

- 将 `vendor/hermes/` 的上游基线从 `v0.9.10`（`df624056a2e8c68bc89ba0a81e1c120856ec9665`）同步到 `v0.9.11`（`71cf5ab7d909318a383bf52bb3ad3cf83a9efc03`），依据两版实际差异做内容三方合并。
- direct 调用优先使用宿主模型注册表的流式接口；provider 错误保留原因并归类为 `provider_error`，保留认证轮换、备用模型和本地诊断日志。
- 合入多行元数据解析、记忆作用域查询索引和 Windows/macOS 临时回顾会话清理修复。
- 合入记忆子进程的工具限制、MCP 排除、策略注入豁免及错误显示修复，但不启用后台子进程回退。
- 保留角色存储、会话归属、Skills 隔离、完整记忆查询、实例生命周期和关闭行为；同步准确的版本、来源和纯上游哈希记录。

## Capabilities

### New Capabilities

当前没有已发布的 OpenSpec 主规格，以下为本次涉及行为建立规格，不表示这些功能全部首次实现。

- `direct-memory-completion`：后台 direct 调用的 provider 路由、错误归类及既有失败处理约定。
- `memory-mirror`：多行记忆元数据及项目归属同步、作用域内容查询索引。
- `session-index-maintenance`：临时回顾会话的跨平台清理及文件会话保护。
- `memory-child-execution`：保留的记忆子进程执行路径的工具边界、提示注入及错误显示。

### Modified Capabilities

无。当前 `openspec/specs/` 没有已有能力规格。

## Impact

- 上游增量涉及 13 个源码文件及 `package.json`，映射到 `vendor/hermes/`；保留上游文件以外的本地适配文件。
- 重点合并位置为 `handlers/review-memory-ops.ts`、`handlers/background-review.ts`、`handlers/auto-consolidate.ts`、`index.ts`、`constants.ts`、`store/session-indexer.ts` 和 `store/sqlite-memory-store.ts`。
- 现有未提交的 `review-memory-ops.ts` 和未跟踪的 `direct-review-log.ts` 属于当前基线，必须保留；刚完成的 OpenSpec 归档及其他工作区内容不纳入本次同步。
- 更新 `UPSTREAM.md`、`UPSTREAM-FILES.sha256`、`SOURCE.md`、README 的来源版本；仅在需要区分本地文件同步与维护分支状态时补充 `UPSTREAM-UPDATE.md`。
- 上游运行时依赖和 peerDependencies 未变化，不升级 Pi、不修改根依赖、不导入上游测试、发布 CI 或发布脚本，不访问真实记忆数据库。
- 本变更授权范围为计划产物。后续实施仅做必要本地文件修改和一次静态核查；不新增或执行测试，不安装、编译或运行插件，不自动提交、推送或改写 Git 分支。
