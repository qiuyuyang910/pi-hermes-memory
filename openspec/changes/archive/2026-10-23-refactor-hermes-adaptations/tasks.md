# Tasks

本清单的本地实施及限定静态核查已完成，真实 Pi 运行效果尚未验证。依照 design.md 顺序推进，保留当前工作区既有改动；本次没有行为 delta，specs 已跳过。每项的完成依据是实施时交付的结构和代码，不另设逐项测试或重复核查。所有功能判断在迁移阶段完成，最终静态核查不再展开业务调查。

## 1. 交接记录与请求状态

- [x] 1.1 将 Selection、selectionFile 及其现有读取、校验、写入和移除操作迁至 `src/role-handoff.ts`，连接启动和切换路径；完成依据：入口不再重复维护交接格式，已有字段、路径哈希、`wx` 和分支清理时机全部沿用。
- [x] 1.2 将 REQUEST_ENTRY 和 requestLockReason 的既有判定迁至 `src/request-state.ts`，由原 `before_provider_request` 持久化锁定；完成依据：无新增元数据状态，原有请求记录与旧内容判断迁移完整，锁定变量仍属于唯一会话状态。

## 2. 会话编排与命令入口

- [x] 2.1 创建 `src/role-session.ts`，承接原可变状态、configFor、模型查找、工具选择与角色设置应用，以及 session_start 的初始化和恢复；完成依据：启动路径经同一编排对象执行，原配置覆盖、提示注入条件、缺失角色处理与初始化失败分支均被迁移，未产生状态副本。
- [x] 2.2 将同会话切换、reload 交接及两阶段回滚迁入会话编排，复用第 1 组模块；完成依据：原 session ID/文件保留，旧实例关闭、目标设置、owner 落盘、Skills reload 的顺序与原错误处理完整迁移。
- [x] 2.3 将 clear 的空白会话准备、scheduleClear、switchSession、取消和结果通知迁入编排，保留原生替换后的上下文边界；完成依据：取消清理与已接受替换分支仍分开，清理未完成不会输出成功，记忆和 Skills 的保留策略未改变。
- [x] 2.4 创建 `src/role-command.ts` 承接参数解析及 list/current/prompt 输出，修改操作委托编排对象；完成依据：全部子命令、额外参数报错和输出字段保留，命令模块不直接操作数据库或创建/关闭 runtime。
- [x] 2.5 将 `src/index.ts` 收敛为事件、工具和命令接线，完成 before_agent_start、tool_call、session_shutdown 等剩余事件迁移；完成依据：原事件注册顺序及返回值保留，所有 Hermes 代理仍转发到当前实例，关闭与失败拦截仍经过同一会话状态。

## 3. 在线归属计算与 Hermes 适配边界

- [x] 3.1 在现有 `vendor/hermes/src/store/session-ownership.ts` 复用实际路径规范化、项目 SHA-256 和 owner 字段解析，调整 `src/storage.ts`、`vendor/hermes/src/project.ts` 的直接引用；完成依据：重复的在线基础计算被收敛，原入口抛错与历史过滤排除的策略分别保留，路径比较和 Windows namespaced path 语义不变。
- [x] 3.2 完成编排层对现有 `createHermesRuntime` API 的接线；如迁移需要，只调整直接相关的签名/import；完成依据：runtime 仍单独拥有 AsyncLocalStorage、pending、clear 调度和幂等 close，vendor 仍拥有数据库、回填与实时索引，不增加另一套生命周期实现。
- [x] 3.3 完成功能迁移时保留 design.md 行为表中的所有 vendor 接缝，包括 clear 排除、归属过滤、最终新增日志、检索回退、direct-only 和迁移/重建禁用策略；完成依据：这些策略继续由原模块负责，未因入口拆分删除或移动到命令层；角色正文与两份离线脚本保持原边界，无新增数据格式或依赖。

## 4. 限定静态核查与交付

- [x] 4.1 功能迁移完成后，由主线程仅对本次改动文件做一次结构、语法、类型、明确编译级错误及 diff 格式静态核查；完成依据：记录实际覆盖文件和发现，无测试、编译、安装、启动、迁移执行或子 Agent 复核；如发现该范围内错误，仅修复错误并重做同范围核查。
- [x] 4.2 交付具体变更文件、职责分配和静态核查结果，说明真实 Pi 加载、切换、隔离、清理、日志及检索效果尚未运行验证；完成依据：最终回复区分代码完成与运行验收，说明用户可沿 README 的既有运行验收范围确认效果，不把未运行事实标成通过。

实施结果：`src/index.ts` 仅保留接线；新增 `role-session.ts`、`role-command.ts`、`role-handoff.ts`、`request-state.ts`；在线归属计算由既有 vendor `session-ownership.ts` 导出，`src/storage.ts` 和 vendor `project.ts` 复用。其余既有业务改动保留。

静态核查结果：对以上 8 个代码文件各获取一次 LSP 错误/警告诊断，均未返回诊断；已修改的跟踪文件通过限定路径的 `git diff --check`，4 个新增模块未发现尾随空白。未执行编译、运行、测试、依赖安装或迁移，未提交、推送或归档。真实 Pi 加载、切换、隔离、清理、日志和检索效果由用户沿 README 现有验收范围确认。
