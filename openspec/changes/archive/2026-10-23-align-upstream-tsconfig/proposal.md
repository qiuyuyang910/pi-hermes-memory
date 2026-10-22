# Proposal

## Why

本项目已同步 Hermes 0.9.11 源码，但根目录和 vendor 均未配置 TypeScript 项目选项，而上游明确使用 ES2022。现有 LSP 因缺少对应标准库类型，对 `new Error(message, { cause })` 报 TS2554；需要对齐静态检查环境，保留正确的异常因果链。

## What Changes

- 在项目根目录新增 `tsconfig.json`，沿用固定上游 v0.9.11 的 ES2022、Node16 模块解析和严格检查选项。
- 将检查范围适配为 `src/**/*.ts` 与 `vendor/hermes/src/**/*.ts`。
- 设置 `noEmit: true`，省略上游用于构建产物的目录、声明和 source map 配置。
- 保留现有源码、依赖和 Pi 加载方式；不通过删除 `Error.cause` 或降低严格程度消除诊断。

## Capabilities

### New Capabilities

无。本变更只配置静态检查环境，不新增运行时能力，已声明 `skip_specs: true`。

### Modified Capabilities

无。没有运行时行为或现有规格要求变化。

## Impact

- 实施仅新增根目录 `tsconfig.json`；不在 vendor 中复制另一份配置，不改动根包清单、源码、测试、CI 或既有来源记录。
- 来源是上游 v0.9.11 固定提交 `71cf5ab7d909318a383bf52bb3ad3cf83a9efc03` 的 `tsconfig.json`；已从本地保存的官方源码归档读取。
- 编辑器或 LSP 重新加载项目后可使用明确的类型环境；本次不承诺所有现有诊断都会消失。
- 后续实施只做配置文件的静态核查，不安装、编译、运行或执行任何测试，不自动修复因明确配置而新显示的业务源码问题。
