//! Device-local scan hints. Content and portable identity remain in workspace files.
use std::{fs, path::Path};

pub(super) struct FileState {
    pub key: String,
    pub stamp: String,
}

// A timestamp/length pair alone misses same-size edits with restored mtime.
// Include the filesystem's change time and native identity, or disable reuse.
#[cfg(windows)]
pub(super) fn state(path: &Path) -> FileState {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    };
    let empty = || FileState {
        key: String::new(),
        stamp: String::new(),
    };
    let Ok(file) = fs::OpenOptions::new()
        .read(true)
        // Windows can defer timestamp updates until a writer closes its handle.
        // Do not reuse a fingerprint while any writable handle is outstanding.
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
    else {
        return empty();
    };
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return empty();
    }
    let key = format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    );
    let mut basic: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
    let reliable = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle() as _,
            FileBasicInfo,
            &mut basic as *mut _ as _,
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    } != 0
        && basic.ChangeTime > 0
        && (info.nFileIndexHigh != 0 || info.nFileIndexLow != 0);
    let stamp = if reliable {
        format!(
            "win1:{key}:{}:{}:{}:{}:{}",
            basic.CreationTime,
            basic.LastWriteTime,
            basic.ChangeTime,
            info.nFileSizeHigh,
            info.nFileSizeLow
        )
    } else {
        String::new()
    };
    FileState { key, stamp }
}

#[cfg(unix)]
pub(super) fn state(path: &Path) -> FileState {
    use std::os::unix::fs::MetadataExt;
    let Ok(meta) = fs::symlink_metadata(path) else {
        return FileState {
            key: String::new(),
            stamp: String::new(),
        };
    };
    let key = format!("{}:{}", meta.dev(), meta.ino());
    let stamp = format!(
        "unix1:{key}:{}:{}:{}:{}:{}",
        meta.len(),
        meta.mtime(),
        meta.mtime_nsec(),
        meta.ctime(),
        meta.ctime_nsec()
    );
    FileState { key, stamp }
}

#[cfg(not(any(windows, unix)))]
pub(super) fn state(_path: &Path) -> FileState {
    FileState {
        key: String::new(),
        stamp: String::new(),
    }
}

pub(super) fn unchanged(before: &FileState, after: &FileState) -> bool {
    !before.stamp.is_empty() && before.stamp == after.stamp
}

#[cfg(test)]
thread_local! { static CONTENT_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

#[cfg(test)]
pub(super) fn content_read() {
    CONTENT_READS.with(|count| count.set(count.get() + 1));
}

#[cfg(test)]
pub(super) fn take_content_reads() -> usize {
    CONTENT_READS.with(|count| count.replace(0))
}
