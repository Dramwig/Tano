# 桌面 Git 变更插件

在独立桌面产品或官方桌面的**本地工作区**中查看 Git 文件状态、暂存区和工作区差异。网页、移动端和在线工作区没有本机 Git 提供方，会明确显示能力不可用。

```powershell
npm run plugin -- pack examples/plugins/git-inspector artifacts/git-inspector.tano-plugin.json
npm run plugin -- verify artifacts/git-inspector.tano-plugin.json
```

安装系统 Git，将仓库根目录作为 Tano 工作区打开。导入插件包，核对 `native`、`ui` 和两项命令声明，授权后从命令中心或插件工作台打开「Git 变更」。刷新读取已经保存的文件；选择「暂存区」或「工作区」查看单个文件的文本差异。

宿主仅注册 `git.status` 和 `git.diff`。插件不能指定可执行文件、工作目录、环境变量或额外 Git 参数，不能提交、暂存、重置、推送，也不会启动登录或网络连接。每次查询再次验证工作区 UUID、插件摘要、规则和声明；切换工作区、撤销授权或关闭窗口会取消请求。

查询将 Git 索引、分支引用等元数据复制到应用缓存，使用受控配置读取原对象库和工作区。原 `.git` 不写入。不运行系统、全局、include 配置、自定义过滤器、文本转换、外部差异工具或 fsmonitor；因此依赖 LFS、自定义 clean filter 或全局换行设置的文件可能与普通 Git 显示不同，应在原工具中确认。已保存内容仍以工作区文件为准。

当前边界：仓库根目录须包含普通 `.git` 目录；不支持链接工作树、共享对象库、稀疏检出、嵌套仓库和符号链接。查询最多检查 200000 个目录项，复制最多 32 MiB 元数据；每次最多 15 秒，状态最多 1000 项，原始输出最多 256 KiB。未跟踪文件没有 Git 差异，隐藏文件不开放正文差异读取。二进制文件使用 Git 的差异摘要。

`main.ts` 在隔离 Worker 中调用 SDK，Vue 界面只通过消息传递交互。完整开发说明见[插件文档](../../../docs/plugins.md)。
