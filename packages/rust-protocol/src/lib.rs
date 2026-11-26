//! Byte-level helpers for Tano's Markdown workspace protocol.
//! Path classifiers do not validate filesystem access or authorize writes.

use sha2::{Digest, Sha256};

pub const WORKSPACE_DATA_DIRECTORY: &str = ".tano";
pub const OBJECT_DIRECTORY: &str = ".tano/objects";
pub const WORKSPACE_CAPABILITY_PATH: &str = ".tano/capabilities.json";
pub const WORKSPACE_FOLDER_REGISTRY_PATH: &str = ".tano/folders.tano.json";
pub const WORKSPACE_SETTINGS_PATH: &str = ".tano/settings.tano.json";
pub const WORKSPACE_PLUGIN_PATH: &str = ".tano/plugins.tano.json";
pub const WORKSPACE_RELATION_PATH: &str = ".tano/relations.tano-relations.json";
pub const ASSISTANT_RULES_PATH: &str = ".tano/rules/assistant.md";
pub const ANNOTATION_DIRECTORY: &str = ".tano/annotations";
pub const DISCUSSION_DIRECTORY: &str = ".tano/discussions";
pub const TEMPLATE_DIRECTORY: &str = ".tano/templates";
pub const WORKSPACE_VIEW_DIRECTORY: &str = ".tano/views";

/// SHA-256 of the exact bytes, suitable for Tano's expectedHash protocol field.
pub fn content_hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

/// Recognizes a six-character lowercase hexadecimal reference ID.
pub fn is_short_id(id: &str) -> bool {
    id.len() == 6
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Classifies paths inside Tano's portable data directory.
pub fn is_workspace_internal_path(path: &str) -> bool {
    path == WORKSPACE_DATA_DIRECTORY || path.starts_with(".tano/")
}

/// Classifies portable data paths; excludes workspace identity and app caches.
pub fn is_workspace_data_path(path: &str) -> bool {
    let Some(relative) = path.strip_prefix(".tano/") else {
        return false;
    };
    matches!(
        relative,
        "capabilities.json"
            | "folders.tano.json"
            | "settings.tano.json"
            | "plugins.tano.json"
            | "relations.tano-relations.json"
            | "rules/assistant.md"
    ) || (relative.starts_with("objects/") && relative.ends_with(".tano.json"))
        || (relative.starts_with("conflicts/") && relative.ends_with(".json"))
        || relative
            .strip_prefix("templates/")
            .is_some_and(|name| name.strip_suffix(".md").is_some_and(is_short_id))
        || relative.strip_prefix("views/").is_some_and(|name| {
            name.strip_suffix(".tano.json").is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
        })
        || [
            "annotations/",
            "discussions/",
            "document-layout/",
            "suggestions/",
            "tables/",
            "files/",
        ]
        .iter()
        .any(|prefix| {
            relative
                .strip_prefix(prefix)
                .is_some_and(|name| name.strip_suffix(".tano.json").is_some_and(is_short_id))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_exact_content_bytes() {
        assert_eq!(
            content_hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(content_hash(b"# Notes\n"), content_hash(b"# Notes\r\n"));
    }

    #[test]
    fn reference_ids_do_not_accept_other_identity_formats() {
        assert!(is_short_id("a1b2c3"));
        assert!(is_short_id("000000"));
        for invalid in ["A1B2C3", "abcdef0", "12345", "a1b2cg", "\u{ff11}23456"] {
            assert!(!is_short_id(invalid), "{invalid}");
        }
        assert!(!is_short_id("550e8400-e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn identity_and_caches_are_excluded_from_portable_data() {
        for path in [
            WORKSPACE_CAPABILITY_PATH,
            WORKSPACE_SETTINGS_PATH,
            WORKSPACE_RELATION_PATH,
            ".tano/objects/a1b2c3.tano.json",
            ".tano/conflicts/conflict.json",
        ] {
            assert!(is_workspace_internal_path(path));
            assert!(is_workspace_data_path(path));
        }
        for path in [
            ".tano/config.json",
            ".tano/cache.sqlite",
            ".tano/objects/a.json",
        ] {
            assert!(is_workspace_internal_path(path));
            assert!(!is_workspace_data_path(path));
        }
        assert!(is_workspace_internal_path(".tano"));
        assert!(!is_workspace_internal_path(".tano-backup/config.json"));
        assert!(!is_workspace_internal_path("notes/.tano/config.json"));
    }
}
