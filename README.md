# Pi 角色与 Hermes 独立记忆

面向 Pi 1.0.2 的本地扩展，基于 pi-hermes-memory 0.9.10 的 MIT 源码适配。入口为 `src/index.ts`。普通模式使用现有 Hermes 配置与数据；每个角色拥有独立的 Hermes 存储和原生 Pi 会话。

## 加载

本次开发不安装依赖、不改变现有 Pi 设置。以下操作由用户执行。

1. 在此目录按运行 Pi 的同一 Node 环境安装 `package.json` 中的依赖。Pi 的三个 SDK 包按 1.0.2 声明 peer dependency，需确保解析到同一版本。
2. 在 Pi 的 `settings.json` 中移除原版 `npm:pi-hermes-memory`、`pi-roles` 及其独立扩展入口，将本插件目录 `E:/Desktop/program/pi-roles-hermes-memory` 加入 `packages`。也可在不加载原版 Hermes 和 pi-roles 的配置中，以 `-e E:/Desktop/program/pi-roles-hermes-memory/src/index.ts` 加载入口。
3. 重启 Pi。已有普通会话仍是普通模式；带本插件归属记录的已有会话会恢复对应角色。首次启动默认普通模式。

不要同时加载两个 Hermes 实现或两个角色管理实现，以免出现重名工具、重复写入和重复提示。模型、认证、原有全局 AGENTS.md、普通 Skills 和 Magic Context 配置仍由 Pi 原机制管理。本插件不复制认证文件。其他记忆扩展的数据行为不在 Hermes 隔离范围内。

依赖安装命令可使用 `npm install`；若主机包的 peer dependency 解析与当前本地 Pi 安装方式冲突，先调整本地依赖解析，确保三个 Pi 包均为 1.0.2。SQLite 的原生模块必须适配运行 Pi 的 Node。适配源码默认不会自动重建或修改依赖，加载失败会明确报错。

## 命令

| 命令 | 行为 |
| --- | --- |
| `/role list` | 列出角色定义 |
| `/role current` | 显示当前模式、记忆和会话位置 |
| `/role architect` | 恢复该角色在当前项目的最近会话；没有历史时创建空白会话 |
| `/role developer --new` | 创建开发角色的空白会话 |
| `/role off` | 恢复当前项目的最近普通会话；没有历史时创建空白会话 |
| `/role off --new` | 创建普通模式的空白会话 |
| `/role reload` | 重读当前角色的提示、模型、thinking 和业务工具设置 |

切换先等待当前任务结束，再验证角色、工具、模型、会话归属与路径。使用 Pi 原生 `switchSession` 替换整个会话，上一模式的聊天内容不会带入目标会话。`--new` 同样通过原生会话替换打开新建的空白会话。取消时清除本次空白会话和交接记录，保留原实例。原生会话替换后，设置只在新扩展的 `session_start` 中应用；`withSession` 仅使用新上下文反馈结果。

角色会话请使用 `/role <id> --new` 创建。Pi 自带 `/new` 若在角色存储目录创建无归属的新文件，本插件会拒绝初始化其记忆；可使用 `/role off` 或 `/role <id> --new` 恢复。已有角色会话也可以从 Pi 的恢复入口直接打开；角色定义缺失或路径与归属不符时停止目标记忆操作。

初始化失败会显示错误并停用该会话的记忆操作，业务工具调用也会被拦截。使用 `/role off` 可通过新的普通会话实例恢复。若 Pi 自身在构造替换会话时失败，主机可能已经使原上下文失效，需要重新启动 Pi 恢复原会话；本插件不会用旧上下文继续写入或改用公共存储。不能确认主机是否接受替换时，保留本次准备的空白会话文件，避免删除主机可能已打开的文件。

## 角色定义

`roles/*.md` 是可修改、删除和添加的示例。文件名是命令标识，只允许小写英文字母、数字、下划线和连字符，最多 64 个字符；`off`、`list`、`current`、`reload` 为保留命令。四个示例不是固定角色分类。

```yaml
---
name: 我的角色
description: 说明
tools: [read, grep, find, ls]
---
```

frontmatter 支持 `name`、`description`、`model`、`thinking`、`tools`，正文是追加到现有 Pi 提示的角色提示。`model` 使用完整 `provider/model-id`，必须是当前注册且具有认证的可用模型。`thinking` 可选 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，实际等级受 Pi 模型能力约束。

省略 `model` 或 `thinking` 时，切换继承切换前的当前选择；没有可继承的 thinking 时才用 `low`。直接恢复会话时保留 Pi 从会话加载的选择。示例角色不指定模型或思考等级。显式配置优先于继承值。

省略 `tools` 时使用普通模式工具集；指定时限制模型的业务工具，并通过 `tool_call` 拦截未允许的调用。所有原版 Hermes 工具始终加入允许列表，包括记忆读写、完整记忆查询、会话历史搜索和自身 Skills 管理。返回普通模式恢复普通工具集。项目 AGENTS.md 仍由 Pi 加载，角色提示不会替代项目指令。

工具选择和调用拦截属于 Pi 扩展级控制。其他扩展自行执行代码或直接访问文件系统不受角色工具列表约束。

## 存储与原文

普通模式继续读取 `~/.pi/agent/hermes-memory-config.json`。本机配置的全局记忆目录为 `D:/pi-hermes-memory`，普通会话继续使用 Pi 原布局。普通模式和角色的新活动项目目录均使用规范化实际工作目录的 SHA-256 标识，同名不同路径不会共享活动项目记忆；角色会话目录也使用该标识。旧普通项目目录和 SQLite 中原项目名称的记录保留，不自动迁移或归入任何新项目。旧记录可通过 `memory_search` 显式按原项目名称查询；尚未索引的旧 Markdown 可由用户使用原有 `/memory-sync-markdown` 命令索引，文件仍留在原位置。

```text
.state/roles/<id>/
  pi-hermes-memory/       MEMORY.md、USER.md、SQLite 历史和记忆索引、skills/
  projects-memory/<项目标识>/
  sessions/<项目标识>/   Pi 原生 JSONL 会话
```

会话 custom entry 持久化角色、项目、规范化目录和存储根，恢复时与实际位置核对。角色目录重定向到其他实际路径会被拒绝。`.state/handoff/` 只保存会话替换所需的模型标识、thinking 和普通工具列表，不包含认证或聊天内容；初始化后删除。

`memory_search` 返回命中条目的完整已保存 `content`，不对单条内容截断；结果数量仍沿用 Hermes 的默认 10 条、最多 20 条。工具名不变，但执行对象随实例切换。`session_search` 查询所属实例的聊天历史索引；记忆条目与聊天原文是两个不同的数据源。`/memory-insights` 保留概览和预览用途，不能当作完整原文查询。

保留 Hermes 的记忆读写、用户资料、项目记忆、历史搜索、回顾、纠错、整理、生成 Skills 和原有命令。角色配置只调整业务工具，不禁用自身记忆写入。角色 Skills 只从当前实例的全局和当前项目目录发现，不迁移或自动加载另一模式的 Hermes Skills。

普通模式沿用现有 Hermes 配置，角色沿用其非路径设置并覆盖为角色专属路径。默认 policy-only、full、回顾 20 轮／30 次工具调用；后台 thinking 默认 off，独立于主角色 thinking。后台调用固定 direct；失败显示诊断，不能回退到子进程。手动和自动整理均使用当前模型上下文。关闭流程幂等，等待在途操作、回顾、回填和实时索引结束后关闭所属数据库。

## 用户运行验收

本次只进行静态核查，没有安装、编译、启动 Pi 或执行测试。实际加载和隔离效果尚未验证。用户运行验收应覆盖：

- 普通模式与两个角色分别写入不同记忆、资料和 Skills，再各自查询；角色历史搜索只出现自身会话。
- 使用 `memory_search` 查询长记忆条目，确认完整内容；区分 `/memory-insights` 预览和 `session_search` 聊天历史。
- 改变当前主模型和 thinking 后切换到未指定它们的角色，确认继承；显式设置后确认覆盖。
- 往返角色和普通模式恢复对应最近会话；`--new` 不携带原聊天；直接打开角色历史能恢复归属。
- 在同名不同实际路径的项目中使用同一角色，确认项目记忆和会话目录标识不同。
- 切换取消、初始化失败、重读角色、扩展重载和退出后确认没有后台串写、公共目录回退或残留在途写入。
- 修改、添加、删除示例角色，确认定义生效；只读角色的业务写入工具被拦截，自身记忆工具仍可用，项目指令仍有效。

源码由 Git 管理并推送到自己的仓库。`roles-hermes` 保存角色插件，`hermes-upstream` 保存原版 Hermes 基线；后续上游升级流程见 [UPSTREAM-UPDATE.md](UPSTREAM-UPDATE.md)。`.gitignore` 排除记忆、会话、数据库、交接状态、凭据、日志与依赖。上游来源和适配范围见 `SOURCE.md`，当前基线引用与提交号见 `UPSTREAM.md`。
