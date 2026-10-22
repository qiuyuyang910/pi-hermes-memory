# Design

## Context

动机与范围见 `proposal.md`，行为契约见本变更的四份 delta specs。

- 当前分支为 `roles-hermes`，HEAD 为 `a9d8761`。`UPSTREAM.md` 记录纯上游基线 `v0.9.10` / `df624056a2e8c68bc89ba0a81e1c120856ec9665`，`vendor/hermes/package.json` 为 0.9.10。
- 已核对官方比较：<https://github.com/chandra447/pi-hermes-memory/compare/v0.9.10...v0.9.11>。目标固定为 `71cf5ab7d909318a383bf52bb3ad3cf83a9efc03`，共 9 个增量提交，13 个源码文件发生变化，没有新增上游源码文件；包清单只改变版本和 repository URL，运行时依赖及 peerDependencies 未变。
- 工作区 `vendor/hermes/src/handlers/review-memory-ops.ts` 已有诊断日志修改，并引用未跟踪的 `direct-review-log.ts`。刚归档的旧 OpenSpec 变更以及其他未提交内容同属当前工作区基线。
- `review-memory-ops.ts` 当前直接调用全局 `completeSimple`，仅将认证错误状态转为异常；普通 provider 错误可能继续进入解析。上游 #298、#299 分别修复注册表路由和错误状态处理。
- `background-review.ts` 的 direct 失败分支已经通知后返回；`auto-consolidate.ts` 也在 direct 失败或缺少上下文时禁止子进程回退。README 明确后台调用固定 direct。
- `sqlite-memory-store.ts` 的 `parseMetadataComment` 当前缺少 dotAll 标志；`session-indexer.ts` 的临时清理仍限定 `/tmp` 和单条消息。上游分别修复这些具体条件。
- `scripts/import-hermes.ps1` 只接受干净的 `hermes-upstream` 分支，并会覆盖 vendor 和删除上游之外的文件，不能在当前角色工作区直接执行。

## Goals / Non-Goals

**Goals:**

- 在固定的纯上游基线、当前实际文件和固定目标源码之间做内容三方合并，既引入本次上游变化，也保留本地适配和未提交改动。
- 将 provider 错误、解析错误和角色插件禁止子进程回退的行为保持为不同问题，避免用日志或错误分类替代真正的 provider 修复。
- 让来源与哈希记录准确描述同步后的源码，不将本地文件同步表述为已经推进 Git 维护分支。

**Non-Goals:**

- 不直接合并移动中的 upstream/main，不整体覆盖角色 vendor，不重构角色管理代码。
- 不启用新的传输方式，不调整角色配置、模型配置、记忆内容或诊断日志内容策略。
- 不修改依赖、测试、CI、发布流程、导入脚本，也不访问或迁移真实数据库；已有数据库只在用户后续正常启动时按上游路径创建新增索引。
- 本计划不包含 Git 提交、推送、切换分支、stash、清理工作区或更新维护分支引用。

## Decisions

### 1. 在当前工作区按固定快照合并文件

使用纯 `v0.9.10` 为 base、当前文件为 ours、固定 0.9.11 提交为 theirs。取得固定提交的完整 `src/`、LICENSE 和 package.json 快照，统一为 UTF-8 无 BOM、LF；临时源码留在现有被忽略的 `.state/hermes-import/` 范围。对有增量的文件局部合并，无上游变化的文件及本地新增文件保持当前内容。

不在当前工作区执行导入脚本，也不为本次本地同步新增导入器。已有文档的“纯基线提交后进行 Git merge”流程仍可供以后单独授权的分支维护使用；本次采用同样的三方内容依据而不生成 Git 合并提交。这样可以保留未提交日志改动和归档，无须自动 stash 或提交用户文件。

### 2. direct 修复和日志在同一路径合并

合入 `ModelRegistry.streamSimple(...).result()` 路由、上游结构类型和旧宿主全局调用路径，保留 `deps.completeSimple` 的现有优先级。保留方法调用时的 registry 接收者，以及现有鉴权、session header、thinking、超时和取消参数。

在 `completeOnce` 中保留当前 request/response 日志，并将所有 `stopReason === "error"` 转为带原因的异常，使现有认证拒绝分支先完成凭据轮换，再由外层返回 `provider_error`。普通格式不符仍为 `parse_error`，继续保留 reviewId 和日志路径。合入旧宿主升级提示，不将此次同步宣称为所有历史 `parse_error` 的根因修复。

### 3. 保留角色插件的 direct-only 约定

后台回顾、整理等既有 direct-only 分支保持不变。子进程相关上游修复作为保留源码路径的一部分同步，不通过修改配置或去掉提前返回来恢复子进程回退。`constants.ts` 中既有本地提示调整与上游工具名常量共同保留。

### 4. 按上游范围合入存储和子进程变化

| 范围 | 拟改文件（均相对 vendor/hermes/src/） | 合并方式 |
| --- | --- | --- |
| direct | `handlers/review-memory-ops.ts` | 保留本地日志后合入 provider 路由和错误分类 |
| 诊断 | `handlers/auto-consolidate.ts`、`handlers/background-review.ts` | 合入共享 stderr 清理，保留 direct-only 分支 |
| 子进程 | `handlers/pi-child-process.ts`、`handlers/child-process-watchdog.mjs` | 合入工具 allowlist、MCP 排除和环境标记 |
| 提示与工具 | `index.ts`、`prompt-context.ts`、`constants.ts`、`tools/memory-tool.ts` | 传递子进程标记并复用三项工具名，不覆盖实例事件适配 |
| 元数据 | `store/sqlite-memory-store.ts` | 仅为现有元数据表达式合入 dotAll 标志，保留角色查询和完整正文行为 |
| 查询索引 | `store/schema.ts`、`store/db.ts` | 新库 schema 与现有库索引创建路径均增加上游 `(target, project, category, content)` 索引，不新增 schema 版本或迁移框架 |
| 会话清理 | `store/session-indexer.ts` | 合入附件标识、用户消息与无文件记录条件，保留所属实例索引逻辑 |

上游测试只作为官方修复背景，不导入、修改或执行。原有角色适配文件和 `direct-review-log.ts` 不因不属于纯上游快照而被删除。

### 5. 来源记录以纯目标快照为准

更新 vendor package.json 至 0.9.11，LICENSE 如内容一致则保持。`UPSTREAM-FILES.sha256` 对完整目标快照的纯 `src/` 生成哈希，不能对角色适配后的 vendor 文件生成“纯上游”哈希。同步 `UPSTREAM.md`、`SOURCE.md` 和 README 的来源版本及固定提交。

`hermes-upstream` 分支在本次文件同步中不推进。`UPSTREAM.md` 和 `UPSTREAM-UPDATE.md` 应准确区分目标源码基线与 Git 维护分支状态，并说明后续三方依据需要使用这里记录的固定标签，而不能假定维护分支已更新。

## Risks / Trade-offs

- [同一文件的上游修改与未提交日志改动重叠] → 以当前实际文件为 ours，局部合并，不采用整文件上游替换；日志文件继续保留。
- [将子进程修复理解为恢复回退] → 保持 direct-only 分支和配置，不改变角色实例调用边界。
- [维护分支落后于文件来源记录] → 文档同时说明二者状态，后续分支维护单独授权，不制造已提交或已合并的记录。
- [已有数据库仍含错误镜像或临时会话] → 本次只合入上游正常初始化、同步和清理路径；不主动清库、重建索引数据或操作用户记忆。
- [静态检查不能证明 provider 调用和数据库运行结果] → 交付明确区分源码同步和运行验收，运行验收交给用户。

## Migration Plan

1. 进入 apply 后仅确认本计划列出的文件是否出现影响方案的新改动；沿用本次已确认的版本和合并依据。
2. 取得固定快照，完成上述 13 个源码文件和 vendor 包清单的内容合并，再更新纯上游哈希与来源文档。
3. 功能改动全部完成后，仅对本次修改文件做一次结构、语法、类型和 diff 格式静态核查，不执行安装、编译、运行或任何测试。
4. 本地改动交付时提供修改清单与未覆盖的运行事实，实施任务不因计划文件已完成而打勾。
5. 用户后续自行加载 Pi 验收扩展 provider 的后台调用、provider 错误显示、多行项目失败记忆的查询、临时会话清理和角色隔离；这些不是本次自动执行的任务。

若用户要求撤销本次同步，只依据本次引入的差异撤销相应片段，保留同步前已有的日志、归档和其他工作区内容，不执行整工作区恢复或清理。已在运行时创建的数据库索引不属于本次文件回退操作。
