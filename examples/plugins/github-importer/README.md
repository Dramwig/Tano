# GitHub 议题导入插件

使用自己的服务连接读取一个 GitHub 议题，预览后创建普通 Markdown 文件。密钥由宿主保管，插件不接收密钥。支持已配置 API Key 代理的在线工作区，以及已接入系统凭据库的桌面本地工作区。

```powershell
npm run plugin -- pack examples/plugins/github-importer artifacts/github-importer.tano-plugin.json
npm run plugin -- verify artifacts/github-importer.tano-plugin.json
```

1. 导入、启用并授权插件。在「服务连接与凭据」中选择它和 `https://api.github.com`。
2. 认证方式选择 `Authorization: Bearer`，允许方法只选 `GET`，路径前缀设为 `/repos/`，输入有目标仓库访问权限的个人访问令牌。
3. 打开「GitHub 议题导入」，填写 `owner/repository` 和议题编号，点击「读取并预览」。
4. 核对后点击「确认创建 Markdown」。文件创建在工作区根目录，是用户导入的内容；已有同名文件不会覆盖。导入不包含评论或附件下载。

插件不会向 GitHub 写入数据，不会自动重试，不执行后台同步。导入内容来自第三方，应按普通外部文档处理。浏览器演示未配置持久凭据代理，不能用于真实连接。OAuth 尚未接入；此示例使用 API Key/个人访问令牌。

测试使用合成令牌和模拟议题响应；真实账户令牌需由用户自行在连接界面输入。完整接口见[插件开发文档](../../../docs/plugins.md)。
