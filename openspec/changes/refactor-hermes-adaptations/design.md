# Design

## Context

动机见 `proposal.md` 的 Why。本次以当前工作区为行为基线，Hermes 原版范围以 `UPSTREAM.md` 记录的 v0.9.10 和 `92e28db` 中未适配的 `vendor/hermes` 为参照。包装层 `src/` 和离线脚本属于本地新增代码，不仅包含最近一次 diff。

已确认的结构与证据：

| 当前对象 | 已观察到的职责与耦合 | 本次处理 |
| --- | --- | --- |
| `src/index.ts:14` 的 Selection、`selectionFile` | 保存设置、切换回滚快照和 clear 交接，读取与写入分散在启动和命令中 | 提取交接记录模块，字段和哈希算法不变 |
| `src/index.ts:33` 的 rolesHermes | 持有 runtime、角色、归属、工具、锁定及失败状态；同时注册事件和实现命令 | 分离会话编排与命令，状态仍由一个会话对象持有 |
| `src/index.ts:55` 的 requestLockReason | 检查整个会话的持久化请求记录和旧内容；`before_provider_request` 落盘锁定 | 提取现有判定，不增加新状态或规则 |
| `src/index.ts:115` 的 session_start 与命令中的切换分支 | 都包含模型、工具、实例初始化和失败恢复 | 由会话编排模块负责，共享已有设置应用逻辑，保留阶段差异 |
| `src/storage.ts` 的 canonical/projectId/ownerFromEntries；`vendor/hermes/src/store/session-ownership.ts` 的 sessionBelongsToScope | 重复规范化实际路径、计算项目哈希和校验 owner 字段 | 在现有归属模块共享基础计算与字段解析，调用方保留各自比较和失败策略 |
| `src/hermes-runtime.ts` 的 createHermesRuntime | 捕获注册项，在 AsyncLocalStorage 中执行并跟踪 pending；幂等关闭并回收锁 | 保持生命周期所有者，不拆成通用框架 |
| vendor 的 session-clear、session-indexer、session-search、session-anchor-search | 清除标记同时影响文件、SQL、实时和批量索引及两类查询 | 保持既有清除模块和过滤接入点 |
| vendor 的 memory-store/finalizeTargetMutation、memory-addition-log | 最终 Markdown 新增回执触发日志，SQLite 确认失败保留记忆 | 保持现有观察者接缝和日志模块 |
| `scripts/migrate-role-sessions.mjs`、`scripts/import-hermes.ps1` | 分别承担离线会话迁移和原版源码导入 | 保留独立执行边界，本次无需结构改动 |

已读取对应实现、vendor 差异和 README；以上为静态事实，不表示现有功能已通过运行验收。`openspec list --specs` 返回无现有规格，纯重构已显式跳过 specs。

## Goals / Non-Goals

**Goals:**

- 入口负责连接 Pi API，业务操作由明确的会话编排入口完成；状态不会在拆分后的模块中各保存一份。
- 消除交接记录以及在线归属基础计算的重复实现；无需变更持久化格式。
- 为全部新增代码给出保留或调整的去向，保持上游算法中的适配接缝可定位。

**Non-Goals:**

- 不修正或统一已有不同分支的行为，不把 README 描述与实现潜在差异作为重构时修改功能的理由。发现实质冲突时报告并取得范围决定。
- 不恢复 pristine vendor，不升级 Hermes/Pi，不追求零 vendor diff，不引入依赖注入框架、事件总线、通用状态机或新的兼容层。
- 不修改角色提示正文、数据、数据库 schema、配置字段、日志字段、脚本入口和依赖。

## Decisions

### 1. 按四个已存在的职责拆分入口

| 文件 | 拟定职责 |
| --- | --- |
| `src/index.ts` | 获取插件目录、创建会话编排对象、注册 Hermes 工具/命令代理和 Pi 事件；保持原注册顺序与返回值 |
| `src/role-session.ts`（新增） | 持有原有会话可变状态；包含启动恢复、应用角色设置、同会话切换与回滚、清理替换以及最终关闭；配置解析和模型查找随使用方迁入 |
| `src/role-command.ts`（新增） | 解析 `/role` 参数，生成 list/current/prompt 的原有输出，将修改操作委托给会话编排；不直接创建、关闭或重建 runtime |
| `src/role-handoff.ts`（新增） | 承接 Selection 类型、文件命名、原有边界校验和交接文件读写/移除；保留 `wx`、字段可选性和各分支删除时机 |
| `src/request-state.ts`（新增） | 承接 REQUEST_ENTRY 与 requestLockReason 的现有判断；持久化锁仍由 `before_provider_request` 触发 |

选择普通函数和一个会话编排对象。命令模块读取编排对象提供的当前视图，修改操作调用其方法，不导出可随意改写的共享状态包。只提取已有职责，不逐个事件创建文件。相比仅搬出长命令而保留两个状态所有者，此方案能让启动与切换回滚共享同一上下文；相比通用状态机，它不新增业务状态和转换规则。

`src/roles.ts` 保持 frontmatter 解析与角色列表职责；`src/storage.ts` 保持存储布局、归属期望值、目录约束和空白原生会话创建职责。已有代码足够独立的部分保持原样。

### 2. 在现有归属模块复用计算，保留策略差异

将在线代码重复的实际路径规范化、项目 SHA-256 计算和 owner 字段解析收敛到 `vendor/hermes/src/store/session-ownership.ts`，由 `src/storage.ts` 和 `vendor/hermes/src/project.ts` 使用；复用现有 OWNER_ENTRY 的语义，不增加另一套元数据。

入口严格验证仍抛出原错误，搜索遇到坏会话仍警告并排除，无 scope 时的原版行为仍保留。路径根比较、允许目录和 Windows namespaced path 的使用点按原分支保留；不把“共享基础计算”扩大成统一所有校验策略。迁移脚本继续独立处理其离线路径，避免为复用 TypeScript 让 Node 脚本新增加载器或编译要求。

### 3. runtime 和 vendor 各保留原资源责任

`createHermesRuntime` 继续拥有 scope、注册项、在途调用、clear 调度及 close promise；vendor 安装函数继续拥有 MemoryStore、数据库、回填和实时索引状态。会话编排只能通过现有 runtime 操作边界访问 Hermes，不把数据库连接或 vendor handler 移到角色命令。

关闭顺序保持：拒绝新调用、等待已登记调用、顺序执行 shutdown handler、尝试所有锁资源关闭并汇总错误。普通切换跳过 flush；clear 继续在停止旧实例的写入后清理历史并跳过旧会话最终索引。保留后台 review、回填和实时索引的等待方式，不新增超时或子进程回退。

相比把全部 vendor 改动搬出 vendor，这种方式能保留存储提交和索引事务内部的必要适配点，避免复制上游实现或扩大接口。

### 4. 保留全部新增行为的当前接入点

| 行为组 | 必须保持的内容 |
| --- | --- |
| 角色与请求锁定 | 保留全部 `/role` 子命令、保留字、frontmatter、工具 `*` 语义、Hermes 工具保留、模型/thinking 继承和显式覆盖；请求发出前锁定，失败取消也不解锁 |
| 启动、恢复、切换 | 保留当前实际分支中的提示注入条件、缺失角色回退与自动化抑制；普通切换保留会话 ID/文件和未请求内容，通过 reload 刷新 Skills；回滚失败停用操作；接受替换后不再使用旧 Pi 上下文 |
| 路径与隔离 | 普通配置原位读取、角色独立根、统一 Pi 原生会话目录、实际 cwd 项目哈希、owner 校验、各实例 Skills 发现范围保持不变 |
| 清除与历史查询 | pending/cleared 标记、SQL 排除、事务内防止重建索引、anchor 扫描排除、启动重试均保留；清除不触碰记忆、资料、Skills、日志和其他会话 |
| 记忆与日志 | 保留完整正文查询、自然语言 FTS/LIKE 回退及显式 FTS 语义；仅记录最终保存的新条目；索引异常与日志异常维持现有警告及不回滚语义 |
| 后台与维护 | 保留 direct-only、当前模型上下文、关闭等待、默认 review 轮次/工具次数、禁用自动旧数据迁移及自动依赖重建；离线脚本的日志、冲突及重试语义不变 |

表格是重构约束，不是新增功能需求或已验证的运行结果。完整记忆输出等不需要改动的既有上游实现直接保留。

## Risks / Trade-offs

- [闭包拆分可能产生状态副本或改变回调读取时机] → 会话编排对象单独持有状态；查询读取当时状态，保留原事件顺序和异步等待顺序。
- [恢复与切换回滚看似重复但阶段不同] → 只共享设置应用与交接记录，保留 reload 前后、主机接受替换前后各自的恢复路径和错误语义。
- [路径实现接近但失败策略不同] → 仅复用基础计算和字段解析，保留严格验证与查询过滤的调用方策略。
- [现有未提交改动可能被基线覆盖] → 以当前文件继续局部迁移，保留其行为与格式，不恢复旧提交、不重置暂存区、不执行维护脚本。
- [禁止运行、编译和测试，无法证明行为等价] → 交付只声明完成结构迁移及限定静态核查；用户完成真实 Pi 运行验收后才能确认运行效果。

## Migration Plan

1. 先迁出交接记录与请求状态，再迁移会话编排和命令，始终沿用现有数据类型和字段。
2. 复用在线归属计算并调整直接 import，不改变其他 vendor 业务算法和持久化流程。
3. 完成功能迁移后，主线程只对改动文件做一次结构、语法、类型及 diff 格式静态核查。该阶段不再展开业务调查，不执行编译、运行或测试。
4. 不需要数据迁移、依赖安装或设置变更。用户可在自己运行的 Pi 中按 README 的现有验收范围确认角色切换、恢复、隔离、清理、日志和检索；本任务不创建或执行测试脚本。
5. 若后续用户报告编译或运行错误，依据具体错误另行处理；如需撤销，只撤销本次重构新增的局部改动，保留本轮开始前的全部工作区内容，不使用整文件恢复或 Git reset。
