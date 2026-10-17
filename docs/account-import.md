# Third-party account imports

Desktop imports follow **connect account → select content → preview → save**.
File imports remain available on the second tab. Connecting never writes workspace
files; saving uses the existing Markdown import pipeline and collision handling.

| Platform | Connection | Content selection |
| --- | --- | --- |
| Notion | OAuth 2.0 or integration token | Shared pages and child blocks |
| Confluence Cloud | Atlassian OAuth 2.0 (3LO) | Sites and spaces, then pages |
| Evernote international | OAuth 1.0a or developer token | Notebooks and note bodies via EDAM |
| Trello | OAuth 1.0a or API key + user token | Boards, lists, cards and checklists |
| Roam Research | Graph API token + Graph name | Graph pages and child blocks |
| Asana | OAuth 2.0 or personal access token | Workspace projects and directly listed tasks |
| Workflowy | Official API token | Root nodes and child outlines |
| Jira Cloud | Atlassian OAuth 2.0 (3LO) | Sites and projects, then issues |
| Monday.com | OAuth 2.0 or API token | Boards, groups and item column values |
| Quip | OAuth 2.0 or personal access token | Desktop folder and nested documents |
| Google Docs | OAuth 2.0 or short-lived access token | Drive documents exported as HTML |
| Obsidian | Local Markdown or Vault ZIP | No official account content API |

OAuth is offered only with a configured application. Token-only services show their
actual inputs. The browser demo and mobile client support file import. Product hosts
can supply `WorkbenchRuntime.accountImports` for their account backend; this MIT
repository does not implement a hosted OAuth broker. Both local and online desktop
workspaces use the native backend without sending credentials through a cloud server.

## Application configuration

Create your own apps with each provider, enable APIs and permissions, register
callbacks, and complete any production app review. No built-in application IDs or
secrets are provided. Never put secrets in `VITE_*`, a workspace, `.tano/`, Markdown,
version control, or frontend bundles.

The native host reads JSON from the `TANO_IMPORT_OAUTH` environment variable, or
`import-oauth.json` in the running product's **application data directory** if that
variable is absent. The local and official products have different app identifiers;
use the actual running product's application data path. Restart after configuration.
Include only the services you intend to enable:

```json
{
  "google-docs": {
    "clientId": "YOUR_DESKTOP_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET_IF_REQUIRED",
    "redirectUri": "http://127.0.0.1:43843/callback"
  },
  "confluence": {
    "clientId": "YOUR_ATLASSIAN_CLIENT_ID",
    "clientSecret": "YOUR_ATLASSIAN_CLIENT_SECRET",
    "redirectUri": "http://127.0.0.1:43843/callback"
  }
}
```

`clientSecret` may be omitted for public clients when supported. The default
`redirectUri` is `http://127.0.0.1:43843/callback`. Only HTTP loopback callbacks on
**127.0.0.1 or localhost with an explicit port**, without credentials/query/fragment, are accepted.
The listener always binds to 127.0.0.1. For Notion, register and configure
`http://localhost:43843/callback`: its developer console rejects IP-based redirects.
Register that exact URI where required. If a platform refuses loopback redirects for
your application type, use a supported desktop app type, an available API token, or
a product-owned HTTPS broker via the host interface. Do not relax callback validation.

| Provider ID | App setup and scopes |
| --- | --- |
| `notion` | Public integration with read content; OAuth redirect; client secret |
| `google-docs` | Drive API, desktop OAuth and consent for `https://www.googleapis.com/auth/drive.readonly`; PKCE S256 |
| `asana` | OAuth app with `default` scope, redirect and secret when required; PKCE S256 |
| `confluence` | Atlassian 3LO; `read:space:confluence read:page:confluence read:confluence-content.all` |
| `jira` | Atlassian 3LO; `read:jira-work read:jira-user` |
| `monday` | Monday app; `boards:read`, OAuth redirect and secret |
| `quip` | Quip OAuth app with content read permission, redirect and secret |
| `trello` | API key as `clientId`, OAuth secret as `clientSecret`; read permission for one day |
| `evernote` | Consumer key as `clientId`, consumer secret as `clientSecret`; production approval |

Workflowy and Roam use official API tokens, not this OAuth configuration. Roam also
requires its Graph name and Graph API access. Trello token connections require an
API key and user token. Evernote can infer a NoteStore URL from a standard sharded
developer token, or accept the exact `https://www.evernote.com/shard/.../notestore`
URL supplied by Evernote. China and sandbox Evernote services are not supported.

## Lifetime, limits and fidelity

OAuth tokens remain in native **process memory** and never enter the webview.
Manually entered API tokens pass through the connection form once and are cleared
after submission. Credentials are never saved in browser storage or the workspace.
Connections survive closing/reopening the panel and are
cleared on disconnect or process exit. Restarting and expired tokens require
reconnecting. No background synchronization or token-refresh job is created.

Authorization uses random state, PKCE where supported, or OAuth 1.0a HMAC-SHA1.
Callbacks time out after three minutes and can be cancelled. Closing the panel cancels
its attempt. Provider HTTP requests use fixed HTTPS origins, read-only operations,
no redirects, 30-second timeouts and a 16 MiB response limit. Repeated or excessive
pagination fails instead of silently truncating. Existing file limits still apply:
2,000 files, 50 MiB per file and 100 MiB per batch.

Imports cover current accessible text and lists. Comments, history, third-party
layouts and attachment binaries are excluded; external links may expire. The preview
shows this limitation before saving. Asana subtasks are not fetched recursively.
Quip covers its desktop folder tree, not all documents shared through messages.
Notion child pages can be selected separately. Confluence macros and Jira rich-text
formatting can be simplified in Markdown.

## Validation and provider references

Run account-import service/UI tests, TypeScript, builds and native tests locally.
Fixtures cover pagination, content conversion, errors/cancellation, loopback callbacks,
OAuth 1.0 signatures, and refusing writes/credential forwarding to other origins.
Real-provider consent, app review and import fidelity must be checked after creating
apps and supplying test accounts. Fixture tests do not verify production app readiness.

References: [Evernote EDAM](https://dev.evernote.com/doc/),
[Notion](https://developers.notion.com/),
[Drive export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export),
[Atlassian OAuth](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/),
[Asana](https://developers.asana.com/),
[Trello](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/),
[Monday](https://developer.monday.com/api-reference/docs),
[Workflowy](https://workflowy.com/api-key/),
[Quip](https://quip.com/dev/automation/documentation).
