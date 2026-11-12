# Assistant and agent workflows

[简体中文](../zh-CN/14-助手与Agent工作流.md) · [Guide](00-getting-started.md)

These are practice prompts, not tasks that run when this page opens. The browser demo simulates responses. Real calls need desktop model connections or server models available to your signed-in account in the official product. Check the current connection list for availability.

## Meeting material

Today we agreed on editor and navigation acceptance. Check existing tasks before creating action items. Formula copying still needs verification in the destination editor; do not mark it complete without results.

- [ ] Check undo after editing several blocks as source.
- [ ] Verify relative links in the folder home.
- [ ] Summarize attachment preview limitations.

## Questions, proposals, and execution

1. Select the meeting material and open the inline assistant. Ask for three conclusions and unverified items; continue in the sidebar if needed.
2. Ask “Propose changes only; do not modify: rewrite this paragraph and preserve task status.” Inspect the diff before accepting or reviewing individual suggestions.
3. In a practice document, explicitly ask “Change the first sentence to … and save.” Check the file change list and actual save result. Explicit execution requests can write directly without a second confirmation.
4. Ask for related documents or data tables in this workspace, with sources. References set the focus rather than restricting default workspace access; a selection still limits the requested local rewrite.

Configure desktop API, Codex CLI, or Claude CLI access in model connections. Inspect connection status, session token usage, and available provider quota queries. Usage statistics are not account balances. Credentials and sessions stay outside the workspace.

## Dispatch through @ mentions

After configuring a connection in a supported workspace, check the model and automatic-processing setting in the agent inbox. Type `@` in a document, annotation, or comment, select a real agent from the picker, write a clear request, then save or post it.

- [ ] Observe queued, running, waiting, and completed states; inspect tool receipts in the execution record.
- [ ] Reply in the associated discussion when clarification is needed. Cancellation does not undo completed writes.
- [ ] Local execution requires the app to run. Hosted execution requires a configured, available server and does not make local CLI processes run after the app closes.

Handwritten identity references, copying this page, or `@Agent` inside code do not dispatch tasks. The sample people are not connected agents.

## External MCP

Copy configuration from the desktop MCP panel. Default `review` access allows reading and pending proposals; `read` is read-only; explicit `write` enables legacy direct Markdown writes. Gateway queries cover files, objects, relations, and data tables. Batch proposals still require review in Tano.

Submission is not a saved edit; check per-item receipts. Verify uncertain results or conflicts before repeating an old request.
