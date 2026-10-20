//! System-owned Git synchronization. Plugins can open its UI, never execute writes.
use crate::identity_manifest::{self, IdentityManifest};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub backend: Option<String>,
    pub last_synced: Option<u64>,
    pub message: String,
    pub conflicts: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    action: String,
    remote: Option<String>,
}

struct Git {
    root: PathBuf,
    executable: PathBuf,
    cache: PathBuf,
}
impl Git {
    fn run(&self, args: &[&str], index: Option<&Path>) -> Result<(bool, String), String> {
        fs::create_dir_all(self.cache.join("no-hooks")).map_err(|e| e.to_string())?;
        let out = tempfile::tempfile().map_err(|e| e.to_string())?;
        let err = tempfile::tempfile().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&self.executable);
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("GIT_") {
                cmd.env_remove(key);
            }
        }
        cmd.current_dir(&self.root)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env(
                "GIT_CONFIG_GLOBAL",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            )
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .env("GIT_AUTHOR_NAME", "Tano Sync")
            .env("GIT_AUTHOR_EMAIL", "sync@tano.local")
            .env("GIT_COMMITTER_NAME", "Tano Sync")
            .env("GIT_COMMITTER_EMAIL", "sync@tano.local")
            .args([
                "-c",
                &format!("core.hooksPath={}", self.cache.join("no-hooks").display()),
            ])
            .args([
                "-c",
                "core.fsmonitor=false",
                "-c",
                "commit.gpgSign=false",
                "-c",
                "merge.autoStash=false",
                "-c",
                "core.autocrlf=false",
                "-c",
                "core.symlinks=false",
                "-c",
                "protocol.ext.allow=never",
                "-c",
                "submodule.recurse=false",
            ])
            .args(if cfg!(windows) {
                vec!["-c", "credential.helper=manager"]
            } else {
                vec![]
            })
            .args(args)
            .stdin(Stdio::null())
            .stdout(out.try_clone().map_err(|e| e.to_string())?)
            .stderr(err.try_clone().map_err(|e| e.to_string())?);
        // Only a system-installed credential helper, never a workspace-supplied command.

        if let Some(index) = index {
            cmd.env("GIT_INDEX_FILE", index);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let mut child = cmd.spawn().map_err(|e| format!("无法启动系统 Git：{e}"))?;
        let start = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            if start.elapsed() > Duration::from_secs(90) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git 操作超时；本地提交已保留，可重试".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        };
        use std::io::{Seek, SeekFrom};
        let mut output = String::new();
        let mut out = out;
        out.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        if out.metadata().map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
            return Err("Git 输出超过安全容量，已停止同步".into());
        }
        out.take(32 * 1024 * 1024)
            .read_to_string(&mut output)
            .map_err(|_| "Git 返回了无法识别的文本")?;
        if !status.success() && output.is_empty() {
            // Do not expose remote URLs, credentials or arbitrary helper stderr in the UI.
            output = format!(
                "Git {} 失败；请检查仓库状态、网络与系统认证",
                args.first().unwrap_or(&"操作")
            );
        }
        Ok((status.success(), output.trim_end().to_string()))
    }
    fn ok(&self, args: &[&str]) -> Result<String, String> {
        let (ok, out) = self.run(args, None)?;
        if ok {
            Ok(out)
        } else {
            Err(out)
        }
    }
    fn branch(&self) -> Result<String, String> {
        self.ok(&["symbolic-ref", "--short", "HEAD"])
            .map_err(|_| "分离 HEAD 不能自动同步，请先切换分支".into())
    }
    fn guard(&self) -> Result<(), String> {
        let dot = self.root.join(".git");
        if !dot.is_dir()
            || fs::symlink_metadata(&dot)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("Git 同步需要工作区根目录中的普通 .git 目录".into());
        }
        for name in [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "rebase-merge",
            "rebase-apply",
            "index.lock",
            "objects/info/alternates",
        ] {
            if dot.join(name).exists() {
                return Err("仓库存在未完成操作、锁或共享对象库，请先处理后重试".into());
            }
        }
        crate::workspace_git::validate_sync_paths(&self.root)?;
        let config = self.ok(&["config", "--local", "--no-includes", "--list"])?;
        for line in config.lines() {
            let key = line.split('=').next().unwrap_or("").to_lowercase();
            if key.starts_with("include")
                || key.starts_with("filter.")
                || key.starts_with("merge.")
                || key.starts_with("diff.")
                || key.starts_with("credential.")
                || key.starts_with("url.")
                || key.starts_with("submodule.")
                || key.starts_with("extensions.")
                || key.starts_with("http.")
                || key.starts_with("protocol.")
                || key == "core.gitproxy"
                || key == "core.sshcommand"
                || key == "core.worktree"
                || key == "core.sparsecheckout"
                || key.ends_with(".uploadpack")
                || key.ends_with(".receivepack")
                || key.ends_with(".proxy")
                || key.ends_with(".pushurl")
            {
                return Err(format!(
                    "系统同步暂不支持仓库配置 {key}；请使用外部 Git 处理此仓库"
                ));
            }
        }
        if !self.ok(&["ls-files", "--unmerged"])?.is_empty() {
            return Err("存在未解决的 Git 冲突，请先解决后重试".into());
        }
        Ok(())
    }
    fn validate_tree(&self, tree: &str, workspace: &str) -> Result<IdentityManifest, String> {
        let listing = self.ok(&["ls-tree", "-r", tree])?;
        for line in listing.lines() {
            if !line.starts_with("100644 ") && !line.starts_with("100755 ") {
                return Err("远端含符号链接或子模块，已停止应用".into());
            }
        }
        let config: serde_json::Value =
            serde_json::from_str(&self.ok(&["show", &format!("{tree}:.tano/config.json")])?)
                .map_err(|_| "远端工作区身份无效")?;
        if config.get("id").and_then(|v| v.as_str()) != Some(workspace) {
            return Err("远端不是同一个工作区；请克隆原工作区及 .tano 身份文件".into());
        }
        let manifest: IdentityManifest =
            serde_json::from_str(&self.ok(&["show", &format!("{tree}:.tano/identities.json")])?)
                .map_err(|_| "远端身份清单无效")?;
        identity_manifest::validate(&manifest, workspace)?;
        Ok(manifest)
    }
    fn synchronize(&self, workspace: &str, state: &mut SyncState) -> Result<(), String> {
        self.guard()?;
        identity_manifest::require(&self.root, workspace)?;
        let branch = self.branch()?;
        let remote = self.ok(&["remote", "get-url", "origin"])?;
        validate_remote(&remote)?;
        // git add never follows symlinks; reject tracked link entries before publishing.
        self.ok(&["add", "--all", "--", "."])?;
        let staged = self.ok(&["write-tree"])?;
        self.validate_tree(&staged, workspace)?;
        let (has_head, head) = self.run(&["rev-parse", "--verify", "HEAD"], None)?;
        let changed = !has_head || self.ok(&["rev-parse", "HEAD^{tree}"])? != staged;
        if changed {
            self.ok(&[
                "commit",
                "--no-verify",
                "-m",
                "chore(sync): save workspace changes",
            ])?;
        }
        let head = if changed {
            self.ok(&["rev-parse", "HEAD"])?
        } else {
            head
        };
        let advertised = self.ok(&[
            "ls-remote",
            "--heads",
            "origin",
            &format!("refs/heads/{branch}"),
        ])?;
        let remote_ref = format!("refs/remotes/origin/{branch}");
        let exists = !advertised.is_empty();
        let remote_head = if exists {
            self.ok(&[
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "origin",
                &format!("refs/heads/{branch}:{remote_ref}"),
            ])?;
            self.ok(&["rev-parse", "--verify", &remote_ref])?
        } else {
            String::new()
        };
        if exists && head != remote_head {
            let ours = self.validate_tree(&head, workspace)?;
            let theirs = self.validate_tree(&remote_head, workspace)?;
            let (ancestor, _) =
                self.run(&["merge-base", "--is-ancestor", &remote_head, &head], None)?;
            if !ancestor {
                let (fast_forward, _) =
                    self.run(&["merge-base", "--is-ancestor", &head, &remote_head], None)?;
                if fast_forward {
                    if ours
                        .reserved_ids
                        .iter()
                        .any(|id| !theirs.reserved_ids.contains(id))
                    {
                        return Err("远端丢失已分配身份，已停止应用".into());
                    }
                    self.ok(&["merge", "--ff-only", "--no-edit", &remote_head])?;
                } else {
                    let base = self
                        .ok(&["merge-base", &head, &remote_head])
                        .map_err(|_| "两端没有共同历史，不能自动合并；请克隆原工作区")?;
                    let base_ids = self.validate_tree(&base, workspace)?;
                    let (clean, merge) = self.run(
                        &[
                            "merge-tree",
                            "--write-tree",
                            "--name-only",
                            &head,
                            &remote_head,
                        ],
                        None,
                    )?;
                    let mut lines = merge.lines();
                    let tree = lines.next().unwrap_or("");
                    if tree.len() != 40 && tree.len() != 64 {
                        return Err(
                            "Git 需要支持 merge-tree --write-tree（Git 2.38 或更新版本）".into(),
                        );
                    }
                    let conflicts: Vec<String> = if clean {
                        vec![]
                    } else {
                        lines
                            .take_while(|s| !s.is_empty())
                            .map(String::from)
                            .collect()
                    };
                    let actual: Vec<String> = conflicts
                        .into_iter()
                        .filter(|s| s != ".tano/identities.json")
                        .collect();
                    if !actual.is_empty() {
                        state.conflicts = actual;
                        return Err("两端修改重叠。已保留本地提交和远端历史，未改写工作文件；请在 Git 中解决后重试".into());
                    }
                    let mut merged = merge_identities(&base_ids, &ours, &theirs)?;
                    // The normal scanner computes byte hashes from the merged files.
                    let paths = self.ok(&["ls-tree", "-r", "--name-only", "-z", tree])?;
                    let paths: HashSet<_> = paths.split('\0').collect();
                    for file in &mut merged.files {
                        file.deleted = !paths.contains(file.path.as_str());
                        file.hash.clear();
                        file.version += 1;
                    }
                    identity_manifest::validate(&merged, workspace)?;
                    let temp = tempfile::tempdir_in(&self.cache).map_err(|e| e.to_string())?;
                    let path = temp.path().join("identities.json");
                    fs::write(
                        &path,
                        serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
                    let blob = self.ok(&["hash-object", "-w", path.to_str().ok_or("无效路径")?])?;
                    let index = temp.path().join("index");
                    for args in [
                        vec!["read-tree", tree],
                        vec![
                            "update-index",
                            "--add",
                            "--cacheinfo",
                            "100644",
                            &blob,
                            ".tano/identities.json",
                        ],
                    ] {
                        let (ok, out) = self.run(&args, Some(&index))?;
                        if !ok {
                            return Err(out);
                        }
                    }
                    let (ok, tree) = self.run(&["write-tree"], Some(&index))?;
                    if !ok {
                        return Err(tree);
                    }
                    let commit = self.ok(&[
                        "commit-tree",
                        &tree,
                        "-p",
                        &head,
                        "-p",
                        &remote_head,
                        "-m",
                        "chore(sync): merge workspace changes",
                    ])?;
                    // Git refuses to overwrite worktree edits made after our local checkpoint.
                    self.ok(&["merge", "--ff-only", "--no-edit", &commit])?;
                }
            }
        }
        self.ok(&[
            "push",
            "--no-verify",
            "origin",
            &format!("HEAD:refs/heads/{branch}"),
        ])?;
        state.conflicts.clear();
        state.message = "文件已同步".into();
        state.last_synced = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
        Ok(())
    }
}

fn merge_identities(
    base: &IdentityManifest,
    ours: &IdentityManifest,
    theirs: &IdentityManifest,
) -> Result<IdentityManifest, String> {
    // Independent allocations must never silently coalesce a file/object identity.
    for id in &ours.reserved_ids {
        if !base.reserved_ids.contains(id) && theirs.reserved_ids.contains(id) {
            return Err(format!(
                "两端独立分配了相同 ID {id}；已保留两端历史，请先迁移身份"
            ));
        }
    }
    // Resolve locations by stable ID before combining path records. Otherwise a
    // one-sided move retains the unchanged side's old path as a second live ID.
    let active = |manifest: &IdentityManifest| -> BTreeMap<String, String> {
        manifest
            .files
            .iter()
            .filter(|file| !file.deleted)
            .map(|file| (file.id.clone(), file.path.clone()))
            .collect()
    };
    let base_paths = active(base);
    let our_paths = active(ours);
    let their_paths = active(theirs);
    let mut obsolete_ours = HashSet::new();
    let mut obsolete_theirs = HashSet::new();
    for (id, old_path) in &base_paths {
        match (our_paths.get(id), their_paths.get(id)) {
            (Some(left), Some(right)) if left != right => {
                if left == old_path {
                    obsolete_ours.insert(left.clone());
                } else if right == old_path {
                    obsolete_theirs.insert(right.clone());
                } else {
                    return Err(format!("文件 ID {id} 并发重命名，已暂停同步并保留两端历史"));
                }
            }
            (Some(path), None) | (None, Some(path)) if path != old_path => {
                return Err(format!("删除与重命名冲突：{old_path}；已保留两端历史"));
            }
            _ => {}
        }
    }
    let mut merged = ours.clone();
    let mut files: BTreeMap<String, _> = ours
        .files
        .iter()
        .filter(|file| !obsolete_ours.contains(&file.path))
        .map(|f| (f.path.clone(), f.clone()))
        .collect();
    for right in &theirs.files {
        if obsolete_theirs.contains(&right.path) {
            continue;
        }
        if let Some(left) = files.get(&right.path) {
            if left.id != right.id {
                return Err(format!("同名文件身份冲突：{}；已保留两端历史", right.path));
            }
            if left.deleted != right.deleted {
                let old = base.files.iter().find(|f| f.path == right.path);
                if old == Some(left) {
                    files.insert(right.path.clone(), right.clone());
                } else if old != Some(right) {
                    return Err(format!("删除与修改冲突：{}", right.path));
                }
            }
        } else {
            files.insert(right.path.clone(), right.clone());
        }
    }
    merged.files = files.into_values().collect();
    merged.revision = ours.revision.max(theirs.revision) + 1;
    let ids: std::collections::BTreeSet<_> = ours
        .reserved_ids
        .iter()
        .chain(&theirs.reserved_ids)
        .cloned()
        .collect();
    merged.reserved_ids = ids.into_iter().collect();
    let mut active = HashSet::new();
    for file in &merged.files {
        if !file.deleted && !active.insert(&file.id) {
            return Err("文件 ID 碰撞或并发重命名，已暂停同步并保留两端历史".into());
        }
    }
    identity_manifest::validate(&merged, &ours.workspace_id)?;
    Ok(merged)
}
fn validate_remote(remote: &str) -> Result<(), String> {
    if remote.is_empty()
        || remote.chars().any(|c| c.is_control())
        || remote.starts_with('-')
        || remote.contains("::")
    {
        return Err("远端地址无效".into());
    }
    if remote.starts_with("https://")
        && remote
            .trim_start_matches("https://")
            .split('/')
            .next()
            .unwrap_or("")
            .contains('@')
    {
        return Err("请使用系统认证，不要在远端地址中保存密码或令牌".into());
    }
    if remote.starts_with("https://")
        || remote.starts_with("ssh://")
        || remote.starts_with("git@")
        || Path::new(remote).is_absolute()
    {
        Ok(())
    } else {
        Err("请使用 HTTPS、SSH 或本地绝对路径作为 Git 远端".into())
    }
}
fn save(path: &Path, state: &SyncState) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("缺少同步目录")?)
        .map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(state).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn execute(root: &Path, cache: &Path, request: Request) -> Result<SyncState, String> {
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let path = cache.join("state.json");
    let mut state: SyncState = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|_| "同步配置损坏，已停止操作")?
    } else {
        SyncState::default()
    };
    match request.action.as_str() {
        "status" => return Ok(state),
        "claimCloud" => {
            if state.backend.as_deref() == Some("git") {
                return Err("请先在工作区同步中停用 Git 后端".into());
            }
            state.backend = Some("cloud".into());
        }
        "releaseCloud" => {
            if state.backend.as_deref() == Some("cloud") {
                state.backend = None;
            }
        }
        "disable" => {
            state.backend = None;
            state.message = "同步已停用，本地文件与历史保留".into();
        }
        "configure" | "run" => {
            if state.backend.as_deref() == Some("cloud") {
                return Err("请先断开 Tano 云端文件同步".into());
            }
            let git = Git {
                root: root.to_path_buf(),
                executable: crate::workspace_git::executable(root)?,
                cache: cache.to_path_buf(),
            };
            if request.action == "configure" {
                let remote = request.remote.as_deref().ok_or("请填写远端地址")?;
                validate_remote(remote)?;
                if !root.join(".git").exists() {
                    git.ok(&["init", "-b", "main"])?;
                }
                git.guard()?;
                let (has_remote, existing) = git.run(&["remote", "get-url", "origin"], None)?;
                if has_remote && existing != remote {
                    return Err("origin 已指向另一个地址，请先在外部 Git 中调整".into());
                }
                if !has_remote {
                    git.ok(&["remote", "add", "origin", remote])?;
                }
                state.backend = Some("git".into());
                state.message = "Git 同步已启用".into();
            } else {
                if state.backend.as_deref() != Some("git") {
                    return Err("请先启用 Git 同步".into());
                }
                if let Err(error) = git.synchronize(&request.workspace_id, &mut state) {
                    state.message = error;
                    save(&path, &state)?;
                    return Ok(state);
                }
            }
        }
        _ => return Err("未知同步操作".into()),
    }
    save(&path, &state)?;
    Ok(state)
}
#[tauri::command]
pub async fn workspace_sync(app: tauri::AppHandle, request: Request) -> Result<SyncState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = crate::app_data(&app)?
            .join("workspace-sync")
            .join(&request.workspace_id);
        let id = request.workspace_id.clone();
        crate::with_workspace_session(&id, app.state(), |session| {
            execute(&session.root, &cache, request)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity_manifest::IdentityFile;
    const ID: &str = "6d2c1e7a-3a5e-4b7d-9c21-0f4e8a6b2d11";
    fn git(root: &Path, args: &[&str]) -> String {
        let output = Command::new(crate::workspace_git::executable(root).unwrap())
            .current_dir(root)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env(
                "GIT_CONFIG_GLOBAL",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            )
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{:?}: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
    fn request(action: &str, remote: Option<&Path>) -> Request {
        Request {
            workspace_id: ID.into(),
            action: action.into(),
            remote: remote.map(|p| p.to_string_lossy().into()),
        }
    }
    fn seed(root: &Path) {
        fs::create_dir_all(root.join(".tano")).unwrap();
        fs::write(
            root.join(".tano/config.json"),
            format!(r#"{{"id":"{ID}","format":1}}"#),
        )
        .unwrap();
        let manifest = IdentityManifest {
            format: 1,
            workspace_id: ID.into(),
            revision: 1,
            reserved_ids: vec!["a00001".into()],
            files: vec![IdentityFile {
                path: "note.md".into(),
                id: "a00001".into(),
                hash: String::new(),
                version: 1,
                deleted: false,
            }],
        };
        fs::write(
            root.join(".tano/identities.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(root.join("note.md"), "first\n\nmiddle\n\nlast\n").unwrap();
    }
    #[test]
    fn real_two_device_sync_merge_conflict_and_offline_retry() {
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        let remote = temp.path().join("remote.git");
        fs::create_dir_all(&a).unwrap();
        seed(&a);
        git(
            temp.path(),
            &[
                "init",
                "--bare",
                "--initial-branch=main",
                remote.to_str().unwrap(),
            ],
        );
        let ca = temp.path().join("ca");
        let cb = temp.path().join("cb");
        execute(&a, &ca, request("configure", Some(&remote))).unwrap();
        let result = execute(&a, &ca, request("run", None)).unwrap();
        assert_eq!(result.message, "文件已同步");
        git(
            temp.path(),
            &["clone", remote.to_str().unwrap(), b.to_str().unwrap()],
        );
        execute(&b, &cb, request("configure", Some(&remote))).unwrap();
        fs::write(a.join("note.md"), "first A\n\nmiddle\n\nlast\n").unwrap();
        assert_eq!(
            execute(&a, &ca, request("run", None)).unwrap().message,
            "文件已同步"
        );
        fs::write(b.join("note.md"), "first\n\nmiddle\n\nlast B\n").unwrap();
        let merged = execute(&b, &cb, request("run", None)).unwrap();
        assert_eq!(merged.message, "文件已同步", "{}", merged.message);
        assert_eq!(
            fs::read_to_string(b.join("note.md")).unwrap(),
            "first A\n\nmiddle\n\nlast B\n"
        );
        assert_eq!(
            execute(&a, &ca, request("run", None)).unwrap().message,
            "文件已同步"
        );
        let stable = git(&a, &["rev-parse", "HEAD"]);
        execute(&b, &cb, request("run", None)).unwrap();
        execute(&a, &ca, request("run", None)).unwrap();
        assert_eq!(
            git(&a, &["rev-parse", "HEAD"]),
            stable,
            "no-op sync must not create commits"
        );
        fs::write(a.join("note.md"), "conflict A\n").unwrap();
        execute(&a, &ca, request("run", None)).unwrap();
        fs::write(b.join("note.md"), "conflict B\n").unwrap();
        let conflict = execute(&b, &cb, request("run", None)).unwrap();
        assert!(conflict.conflicts.contains(&"note.md".into()));
        assert_eq!(
            fs::read_to_string(b.join("note.md")).unwrap(),
            "conflict B\n"
        );
        assert!(!b.join(".git/MERGE_HEAD").exists());
        // A push/fetch failure retains a durable local commit and can be retried.
        let moved = temp.path().join("offline.git");
        fs::rename(&remote, &moved).unwrap();
        fs::write(a.join("offline.md"), "offline saved").unwrap();
        let offline = execute(&a, &ca, request("run", None)).unwrap();
        assert_ne!(offline.message, "文件已同步");
        assert_eq!(git(&a, &["show", "HEAD:offline.md"]), "offline saved");
        fs::rename(&moved, &remote).unwrap();
        assert_eq!(
            execute(&a, &ca, request("run", None)).unwrap().message,
            "文件已同步"
        );
    }
    #[test]
    fn real_two_device_sync_preserves_one_sided_rename_and_independent_edit() {
        // Exercise both merge directions, then a fast-forward and a no-op retry.
        for rename_on_remote in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let a = temp.path().join("a");
            let b = temp.path().join("b");
            let remote = temp.path().join("remote.git");
            let ca = temp.path().join("ca");
            let cb = temp.path().join("cb");
            fs::create_dir_all(&a).unwrap();
            seed(&a);
            fs::write(a.join("other.md"), "base\n").unwrap();
            let mut manifest = identity_manifest::read(&a, ID).unwrap().unwrap();
            let mut other = manifest.files[0].clone();
            other.id = "a00002".into();
            other.path = "other.md".into();
            manifest.files.push(other);
            manifest.reserved_ids.push("a00002".into());
            let save_manifest = |root: &Path, manifest: &IdentityManifest| {
                fs::write(
                    root.join(".tano/identities.json"),
                    serde_json::to_vec_pretty(manifest).unwrap(),
                )
                .unwrap();
            };
            save_manifest(&a, &manifest);
            git(
                temp.path(),
                &[
                    "init",
                    "--bare",
                    "--initial-branch=main",
                    remote.to_str().unwrap(),
                ],
            );
            execute(&a, &ca, request("configure", Some(&remote))).unwrap();
            assert_eq!(
                execute(&a, &ca, request("run", None)).unwrap().message,
                "文件已同步"
            );
            git(
                temp.path(),
                &["clone", remote.to_str().unwrap(), b.to_str().unwrap()],
            );
            execute(&b, &cb, request("configure", Some(&remote))).unwrap();
            let (renaming, editing) = if rename_on_remote { (&a, &b) } else { (&b, &a) };
            fs::rename(renaming.join("note.md"), renaming.join("renamed.md")).unwrap();
            let mut renamed = manifest.clone();
            renamed.files[0].path = "renamed.md".into();
            renamed.revision += 1;
            save_manifest(renaming, &renamed);
            fs::write(editing.join("other.md"), "independent edit\n").unwrap();
            let mut edited = manifest.clone();
            edited.files[1].hash = crate::storage::hash(b"independent edit\n");
            edited.files[1].version += 1;
            edited.revision += 1;
            save_manifest(editing, &edited);
            assert_eq!(
                execute(&a, &ca, request("run", None)).unwrap().message,
                "文件已同步"
            );
            assert_eq!(
                execute(&b, &cb, request("run", None)).unwrap().message,
                "文件已同步"
            );
            assert_eq!(
                execute(&a, &ca, request("run", None)).unwrap().message,
                "文件已同步"
            );
            for root in [&a, &b] {
                assert!(!root.join("note.md").exists());
                assert_eq!(
                    fs::read_to_string(root.join("renamed.md")).unwrap(),
                    "first\n\nmiddle\n\nlast\n"
                );
                assert_eq!(
                    fs::read_to_string(root.join("other.md")).unwrap(),
                    "independent edit\n"
                );
                let merged = identity_manifest::read(root, ID).unwrap().unwrap();
                let active: Vec<_> = merged
                    .files
                    .iter()
                    .filter(|file| !file.deleted && file.id == "a00001")
                    .collect();
                assert_eq!(active.len(), 1);
                assert_eq!(active[0].path, "renamed.md");
                let head = git(root, &["rev-parse", "HEAD"]);
                let cache = if root == &a { &ca } else { &cb };
                assert_eq!(
                    execute(root, cache, request("run", None)).unwrap().message,
                    "文件已同步"
                );
                assert_eq!(git(root, &["rev-parse", "HEAD"]), head);
            }
        }
    }
    #[test]
    fn backend_selection_is_durable_and_exclusive() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let cache = temp.path().join("workspace-sync").join(ID);
        fs::create_dir_all(&root).unwrap();
        seed(&root);
        execute(&root, &cache, request("claimCloud", None)).unwrap();
        crate::assert_cloud_sync_available(temp.path(), ID).unwrap();
        assert!(execute(&root, &cache, request("configure", Some(temp.path()))).is_err());
        execute(&root, &cache, request("disable", None)).unwrap();
        execute(&root, &cache, request("configure", Some(temp.path()))).unwrap();
        assert!(execute(&root, &cache, request("claimCloud", None)).is_err());
        assert!(crate::assert_cloud_sync_available(temp.path(), ID).is_err());
        assert_eq!(
            execute(&root, &cache, request("status", None))
                .unwrap()
                .backend
                .as_deref(),
            Some("git")
        );
    }
    #[test]
    fn refuses_identity_collisions_and_configured_execution() {
        let temp = tempfile::tempdir().unwrap();
        seed(temp.path());
        let original = identity_manifest::read(temp.path(), ID).unwrap().unwrap();
        let mut other = original.clone();
        other.files[0].id = "b00001".into();
        other.reserved_ids.push("b00001".into());
        assert!(merge_identities(&original, &original, &other).is_err());
        git(temp.path(), &["init", "-b", "main"]);
        git(
            temp.path(),
            &["config", "filter.evil.clean", "touch should-not-run"],
        );
        let cache = temp.path().join("cache");
        fs::create_dir_all(&cache).unwrap();
        let engine = Git {
            root: temp.path().into(),
            executable: crate::workspace_git::executable(temp.path()).unwrap(),
            cache,
        };
        assert!(engine.guard().unwrap_err().contains("filter.evil.clean"));
        assert!(!temp.path().join("should-not-run").exists());
    }
    #[test]
    fn merges_one_sided_renames_by_identity_and_rejects_divergent_paths() {
        let temp = tempfile::tempdir().unwrap();
        seed(temp.path());
        let base = identity_manifest::read(temp.path(), ID).unwrap().unwrap();
        let mut renamed = base.clone();
        renamed.files[0].path = "renamed.md".into();
        for (left, right) in [(&renamed, &base), (&base, &renamed)] {
            let merged = merge_identities(&base, left, right).unwrap();
            assert_eq!(merged.files.len(), 1);
            assert_eq!(merged.files[0].path, "renamed.md");
            assert_eq!(merged.files[0].id, base.files[0].id);
        }
        let mut edited = base.clone();
        edited.files[0].hash = "a".repeat(64);
        edited.files[0].version += 1;
        assert_eq!(
            merge_identities(&base, &renamed, &edited).unwrap().files[0].path,
            "renamed.md"
        );
        assert_eq!(
            merge_identities(&base, &edited, &renamed).unwrap().files[0].path,
            "renamed.md"
        );
        assert!(merge_identities(&base, &renamed, &renamed).is_ok());
        let mut divergent = base.clone();
        divergent.files[0].path = "other.md".into();
        assert!(merge_identities(&base, &renamed, &divergent).is_err());
        let mut deleted = base.clone();
        deleted.files[0].deleted = true;
        for (left, right) in [(&renamed, &deleted), (&deleted, &renamed)] {
            assert!(merge_identities(&base, left, right).is_err());
        }
    }
    #[test]
    fn merges_independent_identity_allocations_but_rejects_reserved_collisions() {
        let temp = tempfile::tempdir().unwrap();
        seed(temp.path());
        let base = identity_manifest::read(temp.path(), ID).unwrap().unwrap();
        let mut left = base.clone();
        let mut right = base.clone();
        let mut a = base.files[0].clone();
        a.id = "a00002".into();
        a.path = "a.md".into();
        let mut b = a.clone();
        b.id = "b00002".into();
        b.path = "b.md".into();
        left.files.push(a);
        left.reserved_ids.push("a00002".into());
        right.files.push(b);
        right.reserved_ids.push("b00002".into());
        let merged = merge_identities(&base, &left, &right).unwrap();
        assert_eq!(merged.files.len(), 3);
        right.reserved_ids.push("a00002".into());
        assert!(merge_identities(&base, &left, &right).is_err());
    }
    #[test]
    fn refuses_foreign_workspace_before_modifying_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let cache = temp.path().join("cache");
        fs::create_dir_all(&root).unwrap();
        seed(&root);
        git(&root, &["init", "-b", "main"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "-m", "seed"]);
        let engine = Git {
            root: root.clone(),
            cache,
            executable: crate::workspace_git::executable(&root).unwrap(),
        };
        assert!(engine
            .validate_tree("HEAD", "00000000-0000-4000-8000-000000000001")
            .is_err());
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "first\n\nmiddle\n\nlast\n"
        );
    }
}
