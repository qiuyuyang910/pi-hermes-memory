# memory-child-execution Specification

## Purpose

定义保留的记忆子进程路径在工具访问、策略注入和错误显示方面的边界，使其只能通过记忆工具完成任务，同时保留正确的项目工作目录，不改变角色插件后台仅使用 direct 的既有约定。

## Requirements

### Requirement: 记忆子进程只获得记忆写工具

系统 SHALL 将记忆子进程工具限制为 `memory_add`、`memory_replace` 和 `memory_remove`，显式排除 MCP 工具；普通调用及去除模型覆盖后的重试 SHALL 使用同一限制。子进程 SHALL 保留项目工作目录，不获得文件编辑或命令执行工具。

#### Scenario: 构造记忆子进程调用

- **WHEN** 保留路径构造记忆子进程调用或去除模型覆盖后的重试调用
- **THEN** 两种调用均只允许三项记忆写工具，并排除 MCP 工具、文件编辑、命令执行和 Skills 管理工具

### Requirement: 记忆子进程不接收不可用工具的策略提示

系统 SHALL 标记记忆子进程；该子进程在 policy-only 模式下不接收普通交互记忆策略块，仍保留 standing instructions。legacy-inject 模式下现有记忆数据块 SHALL 保留。

#### Scenario: policy-only 子进程构造上下文

- **WHEN** 被标记的记忆子进程使用 policy-only 模式
- **THEN** 提示中不注入普通交互记忆策略块，已有 standing instructions 仍生效

#### Scenario: legacy-inject 子进程构造上下文

- **WHEN** 被标记的记忆子进程使用 legacy-inject 模式
- **THEN** 系统保留原有记忆数据块

### Requirement: 子进程诊断优先显示实际错误

系统 SHALL 从错误显示中清除 ANSI 控制字符，并在存在其他错误内容时过滤模型范围匹配警告；若过滤后没有内容，SHALL 保留原始去色警告，避免显示为空。

#### Scenario: 模型范围警告后出现真实失败

- **WHEN** 子进程标准错误先包含模型范围匹配警告，随后包含实际失败原因
- **THEN** 整理或后台回顾的错误详情优先呈现实际失败原因

#### Scenario: 标准错误只有模型范围警告

- **WHEN** 过滤模型范围警告后没有其他内容
- **THEN** 系统保留去除 ANSI 后的原始警告供诊断
