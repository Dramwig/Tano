use super::{
    hash,
    identity::{assert_workspace_identity, database},
    is_data_table, is_markdown, modified,
    path_guard::{ensure_file_parent, is_workspace_data_path, resolve, resolve_storage},
    Snapshot, WriteResult, MAX_DOCUMENT_BYTES, MAX_WORKSPACE_ENTRIES,
};
use crate::error::NativeError;
use rusqlite::params;
use std::{fs, io::Write, path::Path};

/// Unlike recycling a directory, this never removes hidden or concurrently added children.
pub fn remove_empty_folder(root: &Path, workspace_id: &str, relative: &str) -> Result<(), String> {
    assert_workspace_identity(root, workspace_id)?;
    let target = resolve(root, relative, true)?;
    if fs::symlink_metadata(root.join(relative))
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(NativeError::SymlinkEscape("不能转换符号链接文件夹").into());
    }
    if !fs::symlink_metadata(&target)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err(NativeError::InvalidPath("只能移除空文件夹").into());
    }
    fs::remove_dir(target).map_err(|e| format!("文件夹不为空或无法移除：{e}"))
}

pub fn read(path: &Path) -> Result<Snapshot, String> {
    if !is_markdown(path)
        && !is_data_table(path)
        && path.file_name().is_none_or(|name| {
            name != "capabilities.json"
                && !name.to_string_lossy().ends_with(".tano.json")
                && !name.to_string_lossy().ends_with(".tano-relations.json")
        })
    {
        return Err(NativeError::UnsupportedFormat("当前版本仅编辑 Markdown 文档和数据表").into());
    }
    read_utf8_bounded(path, MAX_DOCUMENT_BYTES, false)
}

pub(crate) fn read_code(path: &Path) -> Result<Snapshot, String> {
    if !super::is_editable_code_path(path) {
        return Err(NativeError::UnsupportedFormat("此文件类型不支持代码/纯文本编辑").into());
    }
    read_utf8_bounded(path, 2 * 1024 * 1024, true)
}

fn read_utf8_bounded(path: &Path, limit: u64, reject_nul: bool) -> Result<Snapshot, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > limit {
        return Err(NativeError::SizeLimit("文档超过编辑大小限制，请使用外部编辑器").into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if reject_nul && bytes.contains(&0) {
        return Err(NativeError::UnsupportedFormat("检测到二进制文件，无法作为纯文本编辑").into());
    }
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| NativeError::InvalidEncoding("文档必须使用 UTF-8 编码"))?;
    Ok(Snapshot {
        content,
        hash: hash(&bytes),
        modified: modified(&metadata),
    })
}

pub fn temporary(path: &Path, content: &[u8]) -> Result<tempfile::NamedTempFile, String> {
    let mut file = tempfile::Builder::new()
        .prefix(".tano-")
        .tempfile_in(path.parent().ok_or("无效路径")?)
        .map_err(|e| e.to_string())?;
    file.write_all(content).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    Ok(file)
}

pub fn create_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    temporary(path, content)?
        .persist_noclobber(path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create(path: &Path, content: &str) -> Result<(), String> {
    if !is_markdown(path)
        && !is_data_table(path)
        && path.file_name().is_none_or(|name| {
            name != "capabilities.json"
                && !name.to_string_lossy().ends_with(".tano.json")
                && !name.to_string_lossy().ends_with(".tano-relations.json")
        })
    {
        return Err(
            NativeError::UnsupportedFormat("请使用 .md、.markdown 或 .table.json 扩展名").into(),
        );
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(NativeError::SizeLimit("文档不能超过 8 MB").into());
    }
    create_atomic(path, content.as_bytes())
}

pub(crate) fn create_code(path: &Path, content: &str) -> Result<(), String> {
    if !super::is_editable_code_path(path) {
        return Err(NativeError::UnsupportedFormat("此文件类型不支持作为代码/纯文本创建").into());
    }
    if content.len() as u64 > 2 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("代码/文本文件不能超过 2 MB").into());
    }
    if content.as_bytes().contains(&0) {
        return Err(NativeError::InvalidEncoding("纯文本内容不能包含空字节").into());
    }
    create_atomic(path, content.as_bytes())
}

pub(crate) fn write_code(
    path: &Path,
    content: &str,
    expected: &str,
) -> Result<WriteResult, String> {
    if !super::is_editable_code_path(path) {
        return Err(NativeError::UnsupportedFormat("此文件类型不支持代码/纯文本编辑").into());
    }
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    if content.len() as u64 > 2 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("代码/文本文件不能超过 2 MB").into());
    }
    if content.as_bytes().contains(&0) {
        return Err(NativeError::InvalidEncoding("纯文本内容不能包含空字节").into());
    }
    let current = read_code(path)?;
    if current.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: current });
    }
    if content == current.content {
        return Ok(WriteResult::Saved { snapshot: current });
    }
    let staged = temporary(path, content.as_bytes())?;
    staged
        .as_file()
        .set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
        .map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    let latest = read_code(path)?;
    if latest.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: latest });
    }
    staged.persist(path).map_err(|e| e.to_string())?;
    Ok(WriteResult::Saved {
        snapshot: Snapshot {
            content: content.into(),
            hash: hash(content.as_bytes()),
            modified: modified(&fs::metadata(path).map_err(|e| e.to_string())?),
        },
    })
}

pub fn write(path: &Path, content: &str, expected: &str) -> Result<WriteResult, String> {
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(NativeError::SizeLimit("文档不能超过 8 MB").into());
    }
    let current = read(path)?;
    if current.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: current });
    }
    if content == current.content {
        return Ok(WriteResult::Saved { snapshot: current });
    }
    let staged = temporary(path, content.as_bytes())?;
    staged
        .as_file()
        .set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
        .map_err(|e| e.to_string())?;
    // Check again after staging: an external writer may have changed the file during I/O.
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    let latest = read(path)?;
    if latest.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: latest });
    }
    staged.persist(path).map_err(|e| e.to_string())?;
    // Return exactly the bytes we committed, not a potentially newer external write.
    Ok(WriteResult::Saved {
        snapshot: Snapshot {
            content: content.into(),
            hash: hash(content.as_bytes()),
            modified: modified(&fs::metadata(path).map_err(|e| e.to_string())?),
        },
    })
}

#[cfg(windows)]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Without MOVEFILE_REPLACE_EXISTING, a concurrent destination creation fails safely.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "linux"))]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let from = CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let to = CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // renameat2 preserves the inode and atomically refuses an existing destination.
    // Android API 26–29 needs the syscall because Bionic lacks the wrapper.
    // SAFETY: both C strings outlive the syscall; no pointer is retained.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "android", target_os = "linux")))]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    fs::hard_link(source, destination).map_err(|e| e.to_string())?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn rename(
    root: &Path,
    workspace_id: &str,
    from: &str,
    to: &str,
    cache: &Path,
) -> Result<(), String> {
    let source = resolve(root, from, true)?;
    let destination = resolve(root, to, false)?;
    if !source.is_file() || !(is_markdown(&destination) || is_data_table(&destination)) {
        return Err(NativeError::UnsupportedFormat("只能重命名 Markdown 文件和数据表").into());
    }
    move_entry(root, workspace_id, from, to, cache)
}

pub fn move_entry(
    root: &Path,
    workspace_id: &str,
    from: &str,
    to: &str,
    cache: &Path,
) -> Result<(), String> {
    if from == to || to.starts_with(&format!("{from}/")) {
        return Err(NativeError::InvalidPath("不能将文件夹移动到自身或子文件夹").into());
    }
    let source = resolve_storage(root, from, true)?;
    let destination = if is_workspace_data_path(to) {
        ensure_file_parent(root, to)?
    } else {
        resolve(root, to, false)?
    };
    let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(NativeError::InvalidPath("只能移动普通文件或文件夹").into());
    }
    if destination.exists() {
        return Err(NativeError::AlreadyExists("目标名称已经存在").into());
    }
    let mut connection = database(cache)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let destination_prefix = format!("{to}/");
    transaction
        .execute(
            "DELETE FROM files WHERE workspace_id=?1 AND (path=?2 OR substr(path,1,length(?3))=?3)",
            params![workspace_id, to, destination_prefix],
        )
        .map_err(|e| e.to_string())?;
    crate::identity_manifest::begin_move(root, workspace_id, cache, from, to)?;
    rename_noclobber(&source, &destination)?;
    let source_prefix = format!("{from}/");
    transaction
        .execute(
            "UPDATE files SET path=?1 || substr(path,length(?2)+1) WHERE workspace_id=?3 AND (path=?2 OR substr(path,1,length(?4))=?4)",
            params![to, from, workspace_id, source_prefix],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    crate::identity_manifest::recover_move(root, workspace_id, cache)?;
    Ok(())
}

fn check_copy_tree(source: &Path, count: &mut usize) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(NativeError::SymlinkEscape("副本包含符号链接或不支持的文件类型").into());
    }
    *count += 1;
    if *count > MAX_WORKSPACE_ENTRIES {
        return Err(format!("副本超过 {MAX_WORKSPACE_ENTRIES} 个文件或文件夹"));
    }
    if metadata.is_dir() {
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            check_copy_tree(&item.map_err(|e| e.to_string())?.path(), count)?;
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(NativeError::SymlinkEscape("复制时遇到符号链接，已停止").into());
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            copy_tree(&item.path(), &destination.join(item.file_name()))?;
        }
    } else if metadata.is_file() {
        let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
    } else {
        return Err(NativeError::InvalidPath("只能复制普通文件或文件夹").into());
    }
    Ok(())
}

pub fn duplicate_entry(root: &Path, from: &str) -> Result<String, String> {
    let source = resolve(root, from, true)?;
    let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(NativeError::InvalidPath("只能复制普通文件或文件夹").into());
    }
    let mut count = 0;
    check_copy_tree(&source, &mut count)?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("文件名包含无法复制的字符")?;
    let (stem, extension) = if metadata.is_file() && is_data_table(&source) {
        name.split_at(name.len() - ".table.json".len())
    } else if metadata.is_file() {
        match name.rfind('.') {
            Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
            _ => (name, ""),
        }
    } else {
        (name, "")
    };
    let parent = from.rsplit_once('/').map(|(parent, _)| parent);
    for number in 1..=10_000 {
        let suffix = if number == 1 {
            " 副本".to_string()
        } else {
            format!(" 副本 {number}")
        };
        let candidate = format!("{stem}{suffix}{extension}");
        let relative = match parent {
            Some(parent) => format!("{parent}/{candidate}"),
            None => candidate,
        };
        let destination = resolve(root, &relative, false)?;
        if destination.exists() {
            continue;
        }
        copy_tree(&source, &destination).map_err(|error| {
            format!("创建副本失败；若目标已出现，请检查部分内容：{relative}（{error}）")
        })?;
        return Ok(relative);
    }
    Err("副本名称已用尽".into())
}
