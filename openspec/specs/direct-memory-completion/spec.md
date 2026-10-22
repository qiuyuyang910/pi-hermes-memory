# direct-memory-completion Specification

## Purpose

定义自动回顾、会话提炼、纠错保存和记忆整理共用的 direct 模型调用行为，让扩展注册的模型服务能够参与后台记忆处理，并保留可追溯的失败原因以及当前角色实例的数据边界。

## Requirements

### Requirement: 后台调用使用宿主可识别的 provider

系统 SHALL 在宿主提供模型注册表流式能力时，通过该能力发起 direct 请求，以支持扩展注册的 provider；宿主未提供该能力时 SHALL 保留现有全局调用路径。

#### Scenario: 使用扩展注册的 provider

- **WHEN** 当前模型由扩展注册，且宿主支持注册表流式调用
- **THEN** 后台请求通过宿主模型注册表发出，不因仅查询全局 provider 注册表而失败

#### Scenario: 宿主缺少注册表流式能力

- **WHEN** 宿主没有该流式能力
- **THEN** 后台请求沿用全局模型调用路径

### Requirement: provider 失败保留真实原因

系统 SHALL 将模型返回的错误状态归类为 `provider_error` 并保留 provider 的错误信息，不将此类响应送入记忆操作解析并误报为 `parse_error`。错误未提供说明时 SHALL 返回明确的默认错误原因。

#### Scenario: provider 返回 HTTP 或初始化错误

- **WHEN** 模型响应为错误状态且携带错误原因
- **THEN** 本次尝试返回 `provider_error` 和该原因，不应用错误响应中的记忆操作

#### Scenario: 旧宿主无法识别扩展 provider

- **WHEN** 宿主缺少注册表流式能力，且调用报 `No API provider registered for api`
- **THEN** 错误保留原始原因，并提示升级到支持该能力的 Pi 版本

### Requirement: 保留认证轮换与模型尝试顺序

系统 SHALL 保留现有认证拒绝后的凭据轮换重试、配置的备用模型顺序和取消行为；新增 provider 错误处理 SHALL 不将普通 provider 错误当作认证拒绝。

#### Scenario: 认证拒绝后取得不同凭据

- **WHEN** 本次调用被认证拒绝，且现有认证机制取得可用的不同凭据
- **THEN** 系统按现有规则重试当前模型，再决定是否尝试下一模型

### Requirement: 后台保持 direct-only 与所属实例写入

系统 SHALL 保留角色插件后台任务的 direct-only 约定；direct 失败时按现有路径反馈错误，不自动启动 `pi -p` 子进程。成功的记忆操作 SHALL 继续写入当前实例的存储，现有 direct 诊断日志 SHALL 保留。

#### Scenario: 后台回顾的 direct 调用失败

- **WHEN** 后台回顾耗尽当前及配置的备用模型后失败
- **THEN** 用户收到 direct 失败诊断，不启动子进程回退

#### Scenario: 角色模式完成记忆写入

- **WHEN** 某角色的后台请求成功产生有效记忆操作
- **THEN** 操作与已有诊断日志沿用该角色实例的存储路径，不写入其他角色或普通模式的存储
