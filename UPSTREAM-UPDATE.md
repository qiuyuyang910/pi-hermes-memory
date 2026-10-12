# 合并 Hermes 上游更新

`origin` 指向自己的 GitHub 仓库；`upstream` 指向原作者仓库。`master` 是可加载的角色插件，`hermes-upstream` 是未经角色适配的 vendor 源码基线。两者已经建立共同基线，后续通过三方合并保留角色改动。远程原有 `main` 不参与此流程。

当前上游引用、提交号与包版本记录在 `UPSTREAM.md`。`UPSTREAM-FILES.sha256` 记录原版基线，`vendor/hermes/` 在 `master` 上包含适配改动。维护分支中仍会保留插件外围文件，但 vendor 部分未适配，不要加载该分支。

重新克隆自己的仓库后，Git 不会带入本机的 upstream 远程配置。首次更新前执行一次：

```powershell
git remote add upstream https://github.com/chandra447/pi-hermes-memory
```

## 更新原版基线

先保存当前工作区改动。选择明确的上游发行标签或提交，不直接用移动中的 main 作为版本记录。以下以未来的版本号 `vX.Y.Z` 为占位符，执行前替换为实际存在的标签。

```powershell
git fetch upstream --tags
git switch hermes-upstream
git pull --ff-only origin hermes-upstream
./scripts/import-hermes.ps1 -Ref vX.Y.Z
git diff --stat
git diff -- vendor/hermes UPSTREAM.md UPSTREAM-FILES.sha256
git add -- vendor/hermes UPSTREAM.md UPSTREAM-FILES.sha256
git commit -m "Import Hermes vX.Y.Z upstream baseline"
git push origin hermes-upstream
```

脚本只接受干净的 `hermes-upstream` 工作区，导入 `src/`、许可证和原版包清单，删除该目录中上游已不存在的文件，统一文本换行并记录准确提交。导入文件临时保存在被忽略的 `.state/hermes-import/`。脚本不自动提交、推送或更新根包依赖。

直连获取失败时，使用本次命令的代理参数，不更改全局代理：

```powershell
git -c http.proxy=http://127.0.0.1:10808 fetch upstream --tags
```

## 合入角色插件

```powershell
git switch master
git pull --ff-only origin master
git switch -c update/hermes-X.Y.Z
git merge hermes-upstream
```

没有冲突时，Git 会合并原版基线到新原版的改动。存在冲突时，按两侧意图编辑文件，使用 `git status` 查看剩余冲突，然后暂存解决的文件并执行 `git merge --continue`。不要整体选择上游版本覆盖角色适配。

合并后的必要处理包括：

- 保留 `createHermesRuntime`、实例存储路径、角色会话归属和生成 Skills 的隔离。
- 保留完整 `memory_search`、主角色 thinking 继承、direct 后台调用和幂等关闭。
- 根据上游包清单变化评估根 `package.json` 的运行时依赖和 Pi 主机接口，更新 `SOURCE.md` 的来源说明。
- 按项目约定完成允许的静态核查；运行验收由用户执行，覆盖 README 中的隔离、切换和失败场景。

确认升级可用后，将升级分支推送到自己的仓库，通过 PR 合入 `master`：

```powershell
git push -u origin update/hermes-X.Y.Z
```

如果放弃正在解决冲突的合并，使用 `git merge --abort`。上游基线导入后若尚未提交且需要放弃，请先确认没有其他需要保留的改动，再处理这些文件；不要在有用户改动时直接恢复整个工作区。
