use crate::error::{NativeError, NativeResult};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub(crate) fn ignored_workspace_name(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
}

/// Existing components must be plain filesystem entries inside the selected root.
pub fn resolve(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    resolve_path(root, relative, must_exist, false).map_err(String::from)
}

pub fn is_workspace_data_path(relative: &str) -> bool {
    tano_protocol::is_workspace_data_path(relative)
}

pub fn is_workspace_data_directory(relative: &str) -> bool {
    if relative == ".tano" {
        return true;
    }
    let Some(path) = relative.strip_prefix(".tano/") else {
        return false;
    };
    matches!(
        path,
        "objects"
            | "conflicts"
            | "annotations"
            | "discussions"
            | "document-layout"
            | "suggestions"
            | "tables"
            | "rules"
            | "templates"
            | "views"
            | "files"
    ) || path.starts_with("objects/")
        || path.starts_with("conflicts/")
}

pub fn resolve_storage(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    resolve_path(root, relative, must_exist, is_workspace_data_path(relative)).map_err(String::from)
}

pub(crate) fn validate_relative_path(relative: &str, workspace_data: bool) -> Result<(), String> {
    validate_relative_path_inner(relative, workspace_data).map_err(String::from)
}

fn validate_relative_path_inner(relative: &str, workspace_data: bool) -> NativeResult<()> {
    if relative.is_empty()
        || relative.len() > 900
        || relative.contains('\\')
        || relative.contains(':')
    {
        return Err(NativeError::InvalidPath("无效的工作空间相对路径"));
    }
    // Check raw components too: Path::components normalizes embedded `.` segments.
    if relative
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(NativeError::SymlinkEscape("路径不能离开工作空间"));
    }
    for (index, component) in Path::new(relative).components().enumerate() {
        let Component::Normal(name) = component else {
            return Err(NativeError::SymlinkEscape("路径不能离开工作空间"));
        };
        let name_string = name.to_string_lossy();
        if (name_string.starts_with('.')
            && !(workspace_data && index == 0 && name_string == ".tano"))
            || name_string.ends_with('.')
            || name_string.ends_with(' ')
            || name_string
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
        {
            return Err(NativeError::InvalidPath("不支持隐藏路径或保留字符"));
        }
    }
    Ok(())
}

fn resolve_path(
    root: &Path,
    relative: &str,
    must_exist: bool,
    workspace_data: bool,
) -> NativeResult<PathBuf> {
    validate_relative_path_inner(relative, workspace_data)?;
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        current.push(component.as_os_str());
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err(NativeError::SymlinkEscape("为保护工作空间，不跟随符号链接"));
            }
            let canonical = fs::canonicalize(&current)?;
            if !canonical.starts_with(root) {
                return Err(NativeError::SymlinkEscape("路径不能离开工作空间"));
            }
        }
    }
    if must_exist && !current.exists() {
        return Err(NativeError::NotFound("文件已不存在"));
    }
    let parent = current
        .parent()
        .ok_or(NativeError::InvalidPath("无效路径"))?;
    if !parent.is_dir() {
        return Err(NativeError::NotFound("目标文件夹不存在"));
    }
    Ok(current)
}

/// Validate the whole destination before creating any parents. Hidden access is
/// granted only to the portable data allowlist, never config.json or other dotfiles.
pub fn ensure_file_parent(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_file_parent_inner(root, relative).map_err(String::from)
}

fn ensure_file_parent_inner(root: &Path, relative: &str) -> NativeResult<PathBuf> {
    let workspace_data = is_workspace_data_path(relative);
    let parts: Vec<_> = relative.split('/').collect();
    validate_relative_path_inner(relative, workspace_data)?;
    for count in 1..parts.len() {
        let parent = resolve_path(root, &parts[..count].join("/"), false, workspace_data)?;
        if !parent.exists() {
            match fs::create_dir(&parent) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(NativeError::Io(error)),
            }
        }
        // Recheck a concurrently created directory, including its symlink status.
        let parent = resolve_path(root, &parts[..count].join("/"), true, workspace_data)?;
        if !parent.is_dir() {
            return Err(NativeError::InvalidPath("目标父路径不是文件夹"));
        }
    }
    resolve_path(root, relative, false, workspace_data)
}
