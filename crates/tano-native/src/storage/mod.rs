use serde::Serialize;
use std::{fs, path::Path, time::UNIX_EPOCH};

pub(crate) const MAX_DOCUMENT_BYTES: u64 = 8 * 1024 * 1024;
pub(crate) const MAX_WORKSPACE_ENTRIES: usize = 20_000;

pub(crate) mod assets;
pub(crate) mod mobile;
pub(crate) mod object_cache;
pub(crate) mod scan_cache;
pub(crate) mod search;
pub(crate) mod session;

mod identity;
mod io;
mod path_guard;
mod scan;

#[cfg(test)]
pub(crate) use identity::reserve_reference_id;
pub(crate) use identity::{
    allocate_reference_id, cached_identity_exists, claim_reference_id, identity_path, native_key,
};
pub use identity::{
    assert_workspace_identity, database, existing_workspace_identity, is_short_id,
    workspace_identity,
};

pub use io::{
    create, create_atomic, duplicate_entry, move_entry, read, remove_empty_folder, rename,
    temporary, write,
};
pub(crate) use io::{create_code, read_code, write_code};
pub use path_guard::{
    ensure_file_parent, is_workspace_data_directory, is_workspace_data_path, resolve,
    resolve_storage,
};
pub(crate) use path_guard::{ignored_workspace_name, validate_relative_path};
pub use scan::scan;
#[cfg(test)]
pub(crate) use scan::{scan_without_content_cache, take_scan_content_reads};

#[derive(Serialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub files: Vec<Entry>,
    #[serde(rename = "newlyCreated", skip_serializing_if = "Option::is_none")]
    pub newly_created: Option<bool>,
    #[serde(rename = "reinitialized", skip_serializing_if = "Option::is_none")]
    pub reinitialized: Option<bool>,
    #[cfg(desktop)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<crate::ssh::types::RemoteWorkspaceInfo>,
}

#[derive(Serialize)]
pub struct Entry {
    pub id: String,
    pub path: String,
    name: String,
    pub kind: String,
    pub(crate) size: u64,
    modified: u64,
    #[serde(rename = "contentHash", skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
}

impl Entry {
    #[cfg(desktop)]
    pub(crate) fn new(
        id: String,
        path: String,
        name: String,
        kind: String,
        size: u64,
        modified: u64,
        content_hash: Option<String>,
    ) -> Self {
        Self {
            id,
            path,
            name,
            kind,
            size,
            modified,
            content_hash,
        }
    }
}

#[derive(Serialize, Debug)]
pub struct Snapshot {
    pub content: String,
    pub hash: String,
    modified: u64,
}

impl Snapshot {
    pub(crate) fn new(content: String, hash: String, modified: u64) -> Self {
        Self {
            content,
            hash,
            modified,
        }
    }
}

#[derive(Serialize, Debug)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum WriteResult {
    Saved { snapshot: Snapshot },
    Conflict { snapshot: Snapshot },
    Missing,
}

pub fn hash(content: &[u8]) -> String {
    tano_protocol::content_hash(content)
}

pub(crate) fn modified(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

pub(crate) fn is_data_table(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        name.to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(".table.json")
    })
}

pub(crate) fn is_editable_code_path(path: &Path) -> bool {
    if is_markdown(path) || is_data_table(path) {
        return false;
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let lower = ext.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "js" | "mjs"
                | "cjs"
                | "ts"
                | "mts"
                | "cts"
                | "jsx"
                | "tsx"
                | "vue"
                | "svelte"
                | "py"
                | "rs"
                | "css"
                | "scss"
                | "less"
                | "html"
                | "htm"
                | "xml"
                | "yaml"
                | "yml"
                | "toml"
                | "ini"
                | "conf"
                | "cfg"
                | "properties"
                | "sh"
                | "bash"
                | "zsh"
                | "sql"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "cc"
                | "java"
                | "kt"
                | "swift"
                | "dart"
                | "go"
                | "rb"
                | "php"
                | "ps1"
                | "dockerfile"
                | "json"
                | "jsonc"
                | "txt"
                | "log"
                | "csv"
                | "tsv"
        ) {
            return true;
        }
    }
    path.file_name().is_some_and(|name| {
        matches!(
            name.to_string_lossy().to_ascii_lowercase().as_str(),
            "dockerfile" | "makefile" | "procfile" | "gemfile" | "rakefile"
        )
    })
}

pub(crate) fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(share) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{share}")
    } else if let Some(local) = value.strip_prefix("\\\\?\\") {
        local.into()
    } else {
        value.into_owned()
    }
}

#[cfg(test)]
use rusqlite::params;
#[cfg(test)]
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::io::Write;

#[cfg(test)]
mod cross_volume_tests;

#[cfg(test)]
mod scan_cache_tests;

#[cfg(test)]
mod tests;
