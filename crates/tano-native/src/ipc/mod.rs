pub(crate) mod agent;
pub(crate) mod attachments;
pub(crate) mod documents;
pub(crate) mod window;
pub(crate) mod workspace;

use crate::{personal_plans, printing, updates};

#[cfg(desktop)]
use crate::{
    assistant, import_connections, plan_connections, plugin_connections, plugin_native,
    plugin_oauth, workspace_git, workspace_sync,
};

type InvokeHandler = fn(tauri::ipc::Invoke<tauri::Wry>) -> bool;

#[cfg(desktop)]
fn desktop_handler(command: &str) -> Option<InvokeHandler> {
    if command == "workspace_git_query" {
        return Some(tauri::generate_handler![workspace_git::workspace_git_query]);
    }
    if command == "workspace_sync" {
        return Some(tauri::generate_handler![workspace_sync::workspace_sync]);
    }
    if command.starts_with("plugin_connections_") {
        return Some(tauri::generate_handler![
            plugin_connections::plugin_connections_list,
            plugin_connections::plugin_connections_save,
            plugin_connections::plugin_connections_remove,
            plugin_connections::plugin_connections_request,
            plugin_oauth::plugin_connections_oauth_providers,
            plugin_oauth::plugin_connections_oauth_start,
            plugin_oauth::plugin_connections_oauth_status,
            plugin_oauth::plugin_connections_oauth_cancel,
        ]);
    }
    if matches!(command, "plugin_native_request" | "plugin_native_cancel") {
        return Some(tauri::generate_handler![
            plugin_native::plugin_native_request,
            plugin_native::plugin_native_cancel,
        ]);
    }
    if command == "open_devtools" {
        return Some(tauri::generate_handler![window::open_devtools]);
    }
    if command.starts_with("assistant_") {
        return Some(tauri::generate_handler![
            assistant::assistant_protocol_version,
            assistant::assistant_connections,
            assistant::assistant_connection_key,
            assistant::cc_switch::assistant_cc_switch_scan,
            assistant::cc_switch::assistant_cc_switch_import,
            assistant::quota::assistant_quota,
            assistant::quota::assistant_quota_save,
            assistant::assistant_models,
            assistant::assistant_connection_save,
            assistant::assistant_connection_remove,
            assistant::assistant_request,
            assistant::assistant_cancel,
            assistant::assistant_sessions_load,
            assistant::inbox::assistant_inbox_load,
            assistant::inbox::assistant_inbox_save,
            assistant::assistant_session_save,
            assistant::assistant_session_delete,
            assistant::assistant_external_sessions,
            assistant::assistant_external_result,
        ]);
    }
    if matches!(
        command,
        "plan_accounts_list"
            | "plan_account_save"
            | "plan_account_remove"
            | "plan_account_oauth"
            | "plan_remote_request"
            | "plan_sync_state_read"
            | "plan_sync_state_write"
    ) {
        return Some(tauri::generate_handler![
            plan_connections::plan_accounts_list,
            plan_connections::plan_account_save,
            plan_connections::plan_account_remove,
            plan_connections::plan_account_oauth,
            plan_connections::plan_remote_request,
            plan_connections::plan_sync_state_read,
            plan_connections::plan_sync_state_write,
        ]);
    }
    if matches!(
        command,
        "import_capabilities"
            | "import_accounts"
            | "import_connect"
            | "import_cancel"
            | "import_disconnect"
            | "import_request"
    ) {
        return Some(tauri::generate_handler![
            import_connections::import_capabilities,
            import_connections::import_accounts,
            import_connections::import_connect,
            import_connections::import_cancel,
            import_connections::import_disconnect,
            import_connections::import_request,
        ]);
    }
    None
}

fn core_handler() -> InvokeHandler {
    tauri::generate_handler![
        updates::update_status,
        updates::update_check,
        updates::update_download,
        updates::update_install,
        workspace::open_workspace,
        workspace::close_workspace,
        workspace::unregister_workspace,
        window::runtime_platform,
        window::tab_drag_release,
        workspace::open_mobile_workspace,
        workspace::mobile_recycled,
        workspace::mobile_recover,
        workspace::search_documents,
        workspace::recent_workspaces,
        workspace::load_session,
        workspace::save_session,
        attachments::import_attachment,
        attachments::read_attachment,
        attachments::write_spreadsheet,
        attachments::export_attachment,
        attachments::export_document,
        printing::document_print_printers,
        printing::document_print_preview,
        printing::document_print_submit,
        window::open_external_url,
        workspace::refresh_workspace,
        documents::reserve_reference_id,
        documents::create_agent_record,
        personal_plans::personal_plans_list,
        personal_plans::personal_plans_read,
        personal_plans::personal_plans_reserve,
        personal_plans::personal_plans_create,
        personal_plans::personal_plans_write,
        documents::read_document,
        documents::write_document,
        documents::create_document,
        documents::create_folder,
        documents::rename_document,
        documents::remove_empty_folder,
        documents::move_entry,
        documents::remove_document,
        documents::change_assistant_file,
        documents::delete_workspace_object,
        documents::reveal_workspace,
        documents::open_workspace_entry,
        documents::workspace_entry_path,
        documents::duplicate_workspace_entry,
        agent::open_workspace_terminal,
        agent::agent_setup,
        agent::agent_changes,
    ]
}

pub(crate) fn dispatch(
    invoke: tauri::ipc::Invoke<tauri::Wry>,
    commands: &'static [&'static str],
    extra: &(impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static),
) -> bool {
    let command = invoke.message.command();
    #[cfg(desktop)]
    if let Some(handler) = desktop_handler(command) {
        return handler(invoke);
    }
    if commands.contains(&command) {
        return extra(invoke);
    }
    core_handler()(invoke)
}
