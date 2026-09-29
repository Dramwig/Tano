/// A stable namespace shared by local and official desktop distributions.
pub fn shared_directory(data_root: &std::path::Path) -> std::path::PathBuf {
    data_root.join("app.tano.desktop").join("locks")
}

use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

/// The OS releases this lock when the session closes or the process crashes.
/// Never unlink a lock file: another opener could then lock a different inode.
pub fn acquire(directory: &Path, id: &str) -> Result<File, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "无效的工作空间身份")?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(format!("{id}.lock")))
        .map_err(|e| e.to_string())?;
    try_lock(&file).map_err(|error| match error {
        fs::TryLockError::WouldBlock => "此工作空间已在另一个 Tano 窗口中打开。请先关闭该窗口；复制的工作目录也可能共享同一空间身份。".to_string(),
        fs::TryLockError::Error(error) => format!("无法锁定工作空间：{error}"),
    })?;
    Ok(file)
}

#[cfg(not(target_os = "android"))]
fn try_lock(file: &File) -> Result<(), fs::TryLockError> {
    file.try_lock()
}

// Rust 1.92's File::try_lock returns Unsupported on Android. Bionic provides
// flock (API 21+); the kernel releases it when the descriptor/process closes.
#[cfg(target_os = "android")]
fn try_lock(file: &File) -> Result<(), fs::TryLockError> {
    use std::os::fd::AsRawFd;
    loop {
        // SAFETY: file owns a valid descriptor for the duration of the call.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        match error.kind() {
            std::io::ErrorKind::Interrupted => continue,
            std::io::ErrorKind::WouldBlock => return Err(fs::TryLockError::WouldBlock),
            _ => return Err(fs::TryLockError::Error(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    #[test]
    fn distributions_coordinate_with_the_legacy_namespace() {
        let data_root = tempfile::tempdir().unwrap();
        let local = shared_directory(data_root.path());
        let official = data_root.path().join("app.tano.desktop").join("locks");
        assert_eq!(local, official);
        let id = uuid::Uuid::new_v4().to_string();
        let local_lock = acquire(&local, &id).unwrap();
        assert!(acquire(&official, &id).is_err());
        drop(local_lock);
        assert!(acquire(&official, &id).is_ok());
    }
    #[test]
    fn excludes_a_second_owner_and_releases_on_drop() {
        let directory = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let first = acquire(directory.path(), &id).unwrap();
        assert!(acquire(directory.path(), &id).is_err());
        let independent = acquire(directory.path(), &uuid::Uuid::new_v4().to_string()).unwrap();
        drop(first);
        let reopened = acquire(directory.path(), &id).unwrap();
        assert!(acquire(directory.path(), "../escape").is_err());
        drop((independent, reopened));
    }

    #[test]
    #[ignore = "subprocess helper, invoked by lock_recovers_after_process_exit"]
    fn child_lock_owner() {
        let directory = std::env::var("TANO_LOCK_TEST_DIR").unwrap();
        let id = std::env::var("TANO_LOCK_TEST_ID").unwrap();
        let _guard = acquire(Path::new(&directory), &id).unwrap();
        fs::write(Path::new(&directory).join("ready"), b"ready").unwrap();
        std::thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn lock_recovers_after_process_exit() {
        let directory = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "workspace_lock::tests::child_lock_owner",
                "--ignored",
            ])
            .env("TANO_LOCK_TEST_DIR", directory.path())
            .env("TANO_LOCK_TEST_ID", &id)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW for the test helper.
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !directory.path().join("ready").exists() && Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let started = directory.path().join("ready").exists();
        let excluded = acquire(directory.path(), &id).is_err();
        let _ = child.kill();
        child.wait().unwrap();
        assert!(started, "child process did not acquire the lock");
        assert!(excluded, "two processes acquired the same workspace");
        assert!(
            acquire(directory.path(), &id).is_ok(),
            "process exit left a stale lock"
        );
    }
}
