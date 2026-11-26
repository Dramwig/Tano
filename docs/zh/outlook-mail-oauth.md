# Outlook / Microsoft 365 邮件登录

[文档目录](README.md) | [本地开发](local-development.md) | [构建与发布](releases.md)

桌面邮件客户端目前在开发频道开放。它用系统浏览器完成 OAuth 2.0 授权码流程（S256 PKCE），并通过 XOAUTH2 连接 IMAP 和 SMTP。刷新令牌保存在操作系统的凭据库中。

## 注册 Microsoft Entra 应用

1. 在 [Microsoft Entra 管理中心](https://entra.microsoft.com/) 打开「应用注册 → 新注册」。支持的帐户类型选「任意组织目录中的帐户和个人 Microsoft 帐户」，对应 `common` 租户。保存概述页中的「应用程序（客户端）ID」。
2. 在「身份验证 → 添加平台」中选择 **Mobile and desktop applications**，注册 `http://localhost`，在高级设置中将 **Allow public client flows** 设为 **Yes**。桌面端监听 IPv4 回环上的动态端口，授权时使用 `http://localhost:{port}/`。公共客户端无需创建 Client Secret。[Microsoft 回调地址说明](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
3. 在「API 权限」加入委托权限。Microsoft Graph 分组只保留 OIDC 权限 `openid`、`profile`、`email` 和 `offline_access`，移除默认 `User.Read`。在「我的组织使用的 API」中选 **Office 365 Exchange Online**，加入 `IMAP.AccessAsUser.All` 和 `SMTP.Send`。授权请求使用 `https://outlook.office.com/IMAP.AccessAsUser.All` 和 `https://outlook.office.com/SMTP.Send`。[OIDC 权限](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc) · [Exchange OAuth 权限](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)

## 本机联调与构建

将 `mail-oauth.json` 保存在对应应用数据目录。Windows 本地版用 `%APPDATA%/app.tano.local/`，官方直下载版用 `%APPDATA%/app.tano.desktop/`，Microsoft Store 版使用自身的 `app.tano.desktop.store` 应用数据目录。配置文件留在本机的应用数据目录，令牌由系统凭据库管理。

```json
{
  "outlook": {
    "clientId": "<Application (client) ID>",
    "tenant": "common",
    "redirectUri": "http://localhost"
  }
}
```

Client ID 按以下顺序取值：表单 `oauthClientId`、运行期 `TANO_MAIL_OUTLOOK_CLIENT_ID`、运行期 `TANO_MAIL_OAUTH`（与上面的 JSON 结构相同）、`mail-oauth.json`、编译期 `TANO_MAIL_OUTLOOK_CLIENT_ID`。直接环境变量还可用 `TANO_MAIL_OUTLOOK_TENANT` 和 `TANO_MAIL_OUTLOOK_REDIRECT_URI` 指定租户及回调地址。

发布时将公开的 Client ID 保存为 `Dramwig/Tano` 和 `Dramwig/Tano-cloud` 的 GitHub Repository Variable `TANO_MAIL_OUTLOOK_CLIENT_ID`。在本机执行桌面打包时，在运行脚本的同一个 shell 设置该环境变量。官方版须固定到含有 Outlook OAuth 实现的已发布 Core 才会内置此值。

## 验收

1. 桌面开发版打开添加邮件账户弹窗并选择 Outlook。确认 `mail_presets_list` 的 `outlook.oauthConfigured` 为 `true`，弹窗可直接点击「使用 Microsoft 账号登录」。
2. 在系统浏览器用测试邮箱登录并同意权限。看到「Outlook 授权成功」后关闭标签页，回到 Tano 确认账号添加成功。
3. 同步收件箱与已发送，打开一封测试邮件确认正文可读。发一封测试邮件到自己的测试邮箱，确认邮件送达并出现在已发送。个人账号与 Microsoft 365 组织账号分别验收，组织账号的 IMAP、SMTP AUTH 和用户同意权限由所在租户管理。
