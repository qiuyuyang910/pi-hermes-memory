# Design

## Context

问题与范围见 `proposal.md`。当前根目录和 `vendor/hermes/` 没有 TypeScript 项目配置，插件从根目录 `src/index.ts` 加载，并引用 vendor 中的 Hermes 源码。

已读取固定提交 `71cf5ab7d909318a383bf52bb3ad3cf83a9efc03` 的上游 `tsconfig.json`：ES2022、Node16、strict；其 `rootDir: "src"`、`include: ["src/**/*.ts"]` 和输出选项针对单一源码目录及构建产物，不适合直接复制到本项目根目录。

本变更采用 `skip_specs: true`，只记录工具配置，不创建运行时行为规格，也不改写已完成的 `sync-hermes-0-9-11` 记录。

## Goals / Non-Goals

**Goals:**

- 用一个根配置统一项目自身和 vendor TypeScript 源码的标准库与模块检查选项。
- 保留上游的严格程度，明确静态检查不生成产物。

**Non-Goals:**

- 不建立构建或测试流程，不安装 TypeScript 或类型依赖，不增加 package scripts。
- 不修改源码、Pi 版本、运行时配置及既有上游哈希清单。
- 不借本次配置变更处理其他诊断，不把声明 ES2022 表述为实际运行验收通过。

## Decisions

### 1. 新增一个根目录配置

最终配置内容为：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "vendor/hermes/src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

除 `noEmit` 和源码范围外，保留的编译选项与固定上游配置一致。两个源码目录使用同一项目，避免复制两份配置或添加继承链。

### 2. 省略上游构建输出设置

不复制 `rootDir`、`outDir`、`declaration` 和 `sourceMap`。本次仅配置检查，且 vendor 在根 `src/` 之外；省略构建目录约束比将其改为另一套产物布局更直接。`noEmit: true` 表达不生成 JavaScript、类型声明或 source map 的目标。

`exclude` 沿用上游的依赖及输出目录；显式 `include` 只覆盖两个 TypeScript 源码树，不额外配置 JavaScript、临时快照、测试或角色数据范围。

### 3. 保留异常代码与诊断边界

ES2022 标准库提供 `Error` 第二个 options 参数的类型定义，源码中的 `{ cause: error }` 保留不动。当前 LSP 是否重新加载配置以及其他现有类型问题，不通过删除参数、增加类型断言、降低 strict 或安装依赖处理。

实施后的静态核查仅限新增配置的 JSON 语法、结构、选项和 diff 格式，不检查业务源码或运行编译器。编辑器实际识别配置及原 TS2554 是否消失由用户后续重新加载 LSP 查看。

## Risks / Trade-offs

- [明确 strict 和模块环境后可能出现其他已有诊断] → 如实报告，不在本次配置范围内修改业务源码或放宽选项。
- [编辑器可能缓存原有项目状态] → 说明用户可重新加载 TypeScript/LSP 项目；本次不将未观察到的重新加载结果标为已验证。
- [配置存在不代表编译或运行成功] → 交付区分配置静态核查与未执行的编译、运行和测试。

## Migration Plan

1. 实施前仅确认根 `tsconfig.json` 仍不存在；若用户已新增配置，先读取该文件并在既定范围内合并，不覆盖用户配置。
2. 新增根配置，保持业务文件、依赖和此前工作区改动。
3. 主线程仅对新增配置做一次静态核查，然后交付；不安装、编译、运行或执行测试。

若用户之后要求撤销，只撤销本次新增的配置或合入片段，不恢复其他工作区文件。
