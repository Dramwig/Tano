# Tano Local privacy policy

Updated: October 30, 2026. [中文](zh/local-privacy.md) · [Code signing policy](code-signing-policy.md)

## Scope and local data

This policy covers the public MIT Tano Local desktop product in
[Dramwig/Tano](https://github.com/Dramwig/Tano), maintained by Zixi Wang (Dramwig).
It describes the current public source; a released installer may contain fewer
features. Consult its source tag and notices. Account-based Tano cloud services
have a separate [privacy policy](https://tano.page/en-us/privacy/).

Local file use requires no Tano account. Markdown, attachments and portable `.tano/`
metadata remain in your selected workspace. Indexes, recovery drafts, assistant
history, settings and device state belong in application data and can contain
private content. Native credentials use the applicable feature's OS credential
store or process-memory lifetime, not portable workspace data. See
[application data](local-development.md), [imports](account-import.md),
[assistant connections](zh/assistant.md) and [planning sync](zh/planning-sync.md).

Local does not automatically upload your workspace to Tano cloud or include the
proprietary Cloud Overlay. It is not a network-isolated program.

## Network behavior and choices

| Trigger | Recipient and data |
| --- | --- |
| Startup and manual version checks | Requests `https://tano.page/releases/local.json` for public version announcements. No document body, workspace path, account credential or device identifier is added. Servers and network providers still see ordinary request metadata such as IP address, time and HTTP client headers. Current Local releases check on startup and have no dedicated switch for this announcement request. This does not download or install updates. |
| Download, source and release links | Your browser contacts the selected site, including GitHub or tano.page. The destination receives normal browser requests and applies its own privacy and cookie rules. |
| Document-linked images, embeds and remote resources | Rendering may contact the host specified by the document's URL without a separate confirmation for each image. The host sees request metadata and the URL, including information embedded in it. Use local attachments and avoid documents containing remote resources for offline work. |
| Model/API connections and local CLI agents | When configured and used, prompts, selected context, tool results and requested files can reach the provider or agent. A local CLI can contact its own cloud provider; local execution does not imply local model inference. Review provider policies and tool permissions. |
| External agents / MCP | Starting MCP or enabling the desktop Agent Gateway gives an agent the access you authorize. Its subsequent transfers depend on that agent's settings and policies. Local IPC or loopback transport does not control what a separate agent does with returned data. |
| Third-party account imports | Authentication and content-selection requests go directly to your chosen provider. Previewed content is saved locally when you confirm import, rather than automatically uploaded to Tano cloud. |
| Optional Git synchronization | When you enable Git sync, committed workspace files, attachments and portable `.tano/` metadata can be pushed to the remote you select. Automatic sync can repeat while the app is open. Review the remote's access and `.gitignore` exclusions before enabling it; disable sync to stop further automatic transfers. The system Git/SSH credential configuration applies. |
| Calendar and Todo connections | Selected task/event data and credentials are exchanged for the authorized operation. If you enable automatic sync, requests can continue while the app is open. Disable automatic sync or disconnect to stop future sync; check the direction and upload options first. |
| Plugins and catalogs | Browsing/downloading a configured catalog contacts its operator. Plugins with granted network/native/connection permissions can contact permitted destinations and process accessible data. Review their code, permissions and operator policies, and revoke permissions or disable plugins when no longer needed. |

Avoid optional connections and remote document resources for offline use. An OS
firewall can block the startup announcement and other requests; corresponding
network features will be unavailable. Not having a cloud account does not itself
disable all network capabilities.

## Third-party policies

The service you choose governs its processing and retention. Supported services
and policy links follow; listing one does not mean it is contacted by default
or that its proprietary client is included in the Local installer.

| Service | Privacy policy |
| --- | --- |
| GitHub (downloads, source, optional Git remotes) | [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |
| Cloudflare (website and version-announcement delivery) | [Cloudflare](https://www.cloudflare.com/privacypolicy/) |
| Google (Calendar / Docs) | [Google](https://policies.google.com/privacy) |
| Microsoft (To Do / system WebView2) | [Microsoft](https://privacy.microsoft.com/privacystatement) |
| Apple (iCloud calendar) | [Apple](https://www.apple.com/legal/privacy/) |
| Feishu calendar | [Feishu](https://www.feishu.cn/privacy) |
| Todoist | [Todoist](https://todoist.com/privacy) |
| Notion | [Notion](https://www.notion.com/trust/privacy-policy) |
| Atlassian (Confluence / Jira / Trello) | [Atlassian](https://www.atlassian.com/legal/privacy-policy) |
| Evernote | [Evernote](https://evernote.com/privacy/policy) |
| Asana | [Asana](https://asana.com/terms/privacy-statement) |
| monday.com | [monday.com](https://monday.com/l/privacy/privacy-policy/) |
| Quip | [Quip](https://quip.com/about/privacy) |
| Workflowy | [Workflowy](https://workflowy.com/privacy-policy/) |
| Roam Research | [Roam](https://roamresearch.com/#/app/help/page/bnQcAUM0i) |
| Optional OpenAI / Codex connections | [OpenAI](https://openai.com/policies/privacy-policy/) |
| Optional Anthropic / Claude connections | [Anthropic](https://www.anthropic.com/legal/privacy) |

For other model endpoints, self-hosted CalDAV servers, Git remotes, plugins,
agents and document resource hosts, consult the relevant operator before use.
Windows, browsers, installed CLIs and system WebView2 have independent settings
and data processing.

## Retention, removal and contact

You manage ordinary workspace files and backups. Disconnect accounts and revoke
provider tokens to end future access. Clearing app data can remove settings,
caches, recovery and session records; export needed data first. Uninstalling does
not by itself erase your workspace, backups, all app data or external-service
copies. Request provider-side deletion from the relevant operator. The project
does not centrally hold your local workspace or have a way to delete it remotely.

Support mail and voluntarily submitted files are processed to handle your request;
email delivery is subject to Google's policy. Send privacy questions or requests
about material supplied to the maintainer to [dramwig@gmail.com](mailto:dramwig@gmail.com).
Do not send passwords, API keys or unrelated private documents. Material changes
will update this policy's date and be described alongside the affected release.
