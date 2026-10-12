# Hermes 上游基线

- 仓库：https://github.com/chandra447/pi-hermes-memory
- 引用：v0.9.10
- 提交：df624056a2e8c68bc89ba0a81e1c120856ec9665
- 包版本：0.9.10
- 导入范围：src/、LICENSE、package.json，映射到 vendor/hermes/。
- 文本编码：UTF-8，无 BOM，CRLF 统一为 LF。

hermes-upstream 仅保存未适配的上游 vendor 源码，供 master 三方合并使用，不用于加载插件。
UPSTREAM-FILES.sha256 记录该基线的 src/ 文件哈希，不是适配后源码的哈希。
更新流程见 UPSTREAM-UPDATE.md。导入脚本不安装、编译、启动、测试、提交或推送。
