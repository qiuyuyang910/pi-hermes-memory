# Hermes 上游基线

- 仓库：https://github.com/chandra447/pi-hermes-memory
- 引用：v0.9.11
- 提交：71cf5ab7d909318a383bf52bb3ad3cf83a9efc03
- 包版本：0.9.11
- 导入范围：src/、LICENSE、package.json，映射到 vendor/hermes/。
- 文本编码：UTF-8，无 BOM，CRLF 统一为 LF。

本次在 roles-hermes 工作区以 v0.9.10 为 base，合入固定 v0.9.11 快照的内容差异，保留角色适配和已有未提交日志改动；没有生成 Git 合并提交或推进分支。
hermes-upstream 仍保存 v0.9.10（df624056a2e8c68bc89ba0a81e1c120856ec9665）的未适配源码，不用于加载插件。它尚未跟随本次文件同步更新，不能作为当前 0.9.11 的纯源码快照。
UPSTREAM-FILES.sha256 记录固定 v0.9.11 快照中 57 个 src/ 文件的哈希，不是适配后源码的哈希。后续内容三方合并应以本文件记录的固定上游引用为 base。
更新流程见 UPSTREAM-UPDATE.md。导入脚本不安装、编译、启动、测试、提交或推送。
