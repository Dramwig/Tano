//! Read-only Git queries using private metadata and an allowlisted configuration.
//! Original config, hooks, remotes, credential helpers and filters are never used by a query.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

const OUTPUT_LIMIT: usize = 256 * 1024;
const METADATA_LIMIT: usize = 32 * 1024 * 1024;
const ENTRY_LIMIT: usize = 200_000;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryArgs {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    staged: bool,
    #[serde(default = "default_log_limit")]
    limit: usize,
}
fn default_log_limit() -> usize {
    30
}
pub fn parse_args(command: &str, value: Value) -> Result<QueryArgs, String> {
    if command == "git.status" && value != json!({}) {
        return Err("Git 状态查询不接受参数".into());
    }
    let args: QueryArgs = serde_json::from_value(value).map_err(|_| "Git 查询参数无效")?;
    if command == "git.diff" {
        crate::storage::validate_relative_path(
            args.path.as_deref().ok_or("请选择一个文件")?,
            false,
        )?;
    }
    if command == "git.log" {
        if let Some(path) = args.path.as_deref() {
            crate::storage::validate_relative_path(path, false)?;
        }
        if !(1..=100).contains(&args.limit) {
            return Err("Git 历史记录最多查询 100 条".into());
        }
    }
    Ok(args)
}
pub fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Git 查询需要的文件已不可用")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > limit as u64 {
        return Err("Git 查询需要普通文件，且文件不能超过容量限制".into());
    }
    let mut result = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法读取 Git 查询文件")?
        .take(limit as u64 + 1)
        .read_to_end(&mut result)
        .map_err(|_| "无法读取 Git 查询文件")?;
    if result.len() > limit {
        return Err("Git 查询文件超过容量限制".into());
    }
    Ok(result)
}
fn check_stop(stopped: &AtomicBool) -> Result<(), String> {
    if stopped.load(Ordering::SeqCst) {
        return Err("插件请求已取消".into());
    }
    Ok(())
}
fn checked(root: &Path, path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Git 查询文件已变化，请重试")?;
    // canonical containment also rejects Windows junctions/reparse points leaving the workspace.
    if metadata.file_type().is_symlink()
        || !fs::canonicalize(path)
            .map_err(|_| "无法验证 Git 路径")?
            .starts_with(root)
    {
        return Err("Git 插件不跟随符号链接或工作区外的目录".into());
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("Git 插件仅支持普通文件和目录".into());
    }
    Ok(metadata)
}
fn inspect_tree(
    root: &Path,
    path: &Path,
    entries: &mut usize,
    stopped: &AtomicBool,
    worktree: bool,
) -> Result<(), String> {
    check_stop(stopped)?;
    *entries += 1;
    if path
        .strip_prefix(root)
        .map_err(|_| "Git 路径越界")?
        .components()
        .count()
        > 64
    {
        return Err("Git 查询目录层级不能超过 64 层".into());
    }
    if *entries > ENTRY_LIMIT {
        return Err("Git 查询最多检查 200000 个目录项，请缩小工作区".into());
    }
    if checked(root, path)?.is_dir() {
        for entry in fs::read_dir(path).map_err(|_| "无法检查 Git 查询目录")? {
            let entry = entry.map_err(|_| "Git 查询目录已变化")?;
            if worktree && entry.file_name() == ".git" {
                if path != root {
                    return Err("Git 插件暂不查询包含嵌套仓库的工作区，请单独打开该仓库".into());
                }
                continue;
            }
            inspect_tree(root, &entry.path(), entries, stopped, worktree)?;
        }
    }
    Ok(())
}
fn executable(root: &Path) -> Result<PathBuf, String> {
    for directory in std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
    {
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join(if cfg!(windows) { "git.exe" } else { "git" });
        if let Ok(candidate) = fs::canonicalize(candidate) {
            if candidate.is_file() && !candidate.starts_with(root) {
                // Git for Windows' cmd/git.exe is a launcher; prefer its actual native executable.
                #[cfg(windows)]
                if let Some(prefix) = candidate.parent().and_then(Path::parent) {
                    for arch in ["mingw64", "mingw32"] {
                        if let Ok(actual) = fs::canonicalize(prefix.join(arch).join("bin/git.exe"))
                        {
                            if actual.is_file() && !actual.starts_with(root) {
                                return Ok(actual);
                            }
                        }
                    }
                }
                return Ok(candidate);
            }
        }
    }
    Err("未找到工作区外的 Git 可执行文件，请先安装 Git 并加入系统 PATH".into())
}
#[derive(Debug)]
pub struct Prepared {
    root: PathBuf,
    git: PathBuf,
    directory: tempfile::TempDir,
    branch: Option<String>,
    originals: Vec<(PathBuf, String)>,
}
fn copy_metadata(
    root: &Path,
    source: &Path,
    target: &Path,
    remaining: &mut usize,
    originals: &mut Vec<(PathBuf, String)>,
    stopped: &AtomicBool,
) -> Result<(), String> {
    check_stop(stopped)?;
    if checked(root, source)?.is_dir() {
        fs::create_dir_all(target).map_err(|_| "无法准备 Git 查询缓存")?;
        for entry in fs::read_dir(source).map_err(|_| "无法读取 Git 元数据")? {
            let entry = entry.map_err(|_| "Git 元数据已变化")?;
            copy_metadata(
                root,
                &entry.path(),
                &target.join(entry.file_name()),
                remaining,
                originals,
                stopped,
            )?;
        }
    } else {
        let bytes = read_bounded(source, *remaining)?;
        *remaining -= bytes.len();
        originals.push((source.to_owned(), crate::storage::hash(&bytes)));
        fs::write(target, bytes).map_err(|_| "无法准备 Git 查询缓存")?;
    }
    Ok(())
}
pub fn prepare(root: &Path, cache: &Path, stopped: &AtomicBool) -> Result<Prepared, String> {
    let root = fs::canonicalize(root).map_err(|_| "工作区已不可用")?;
    let source = root.join(".git");
    if !source.exists() {
        return Err("请将 Git 仓库根目录作为工作区打开".into());
    }
    if !checked(&root, &source)?.is_dir() {
        return Err("Git 插件需要工作区根目录包含普通 .git 目录；暂不支持链接工作树".into());
    }
    for unsupported in [
        "commondir",
        "objects/info/alternates",
        "objects/info/http-alternates",
        "info/sparse-checkout",
    ] {
        if fs::symlink_metadata(source.join(unsupported)).is_ok() {
            return Err("Git 插件暂不支持共享对象库、链接工作树或稀疏检出".into());
        }
    }
    let mut entries = 0;
    inspect_tree(&root, &source, &mut entries, stopped, false)?;
    inspect_tree(&root, &root, &mut entries, stopped, true)?;
    fs::create_dir_all(cache).map_err(|_| "无法准备 Git 查询缓存")?;
    let directory = tempfile::Builder::new()
        .prefix("git-")
        .tempdir_in(cache)
        .map_err(|_| "无法准备 Git 查询缓存")?;
    let mut remaining = METADATA_LIMIT;
    let mut originals = Vec::new();
    for name in ["HEAD", "index", "packed-refs", "shallow", "refs"] {
        let path = source.join(name);
        if path.exists() {
            copy_metadata(
                &root,
                &path,
                &directory.path().join(name),
                &mut remaining,
                &mut originals,
                stopped,
            )?;
        }
    }
    for entry in fs::read_dir(&source).map_err(|_| "无法读取 Git 元数据")? {
        let entry = entry.map_err(|_| "Git 元数据已变化")?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("sharedindex.")
        {
            copy_metadata(
                &root,
                &entry.path(),
                &directory.path().join(entry.file_name()),
                &mut remaining,
                &mut originals,
                stopped,
            )?;
        }
    }
    for name in ["info/exclude", "info/attributes"] {
        let source_file = source.join(name);
        if source_file.exists() {
            fs::create_dir_all(directory.path().join("info"))
                .map_err(|_| "无法准备 Git 查询缓存")?;
            copy_metadata(
                &root,
                &source_file,
                &directory.path().join(name),
                &mut remaining,
                &mut originals,
                stopped,
            )?;
        }
    }
    if source.join("config").exists() {
        copy_metadata(
            &root,
            &source.join("config"),
            &directory.path().join("source-config"),
            &mut remaining,
            &mut originals,
            stopped,
        )?;
    } else {
        fs::write(directory.path().join("source-config"), "")
            .map_err(|_| "无法准备 Git 查询缓存")?;
    }
    fs::create_dir_all(directory.path().join("refs")).map_err(|_| "无法准备 Git 查询缓存")?;
    fs::create_dir_all(directory.path().join("objects")).map_err(|_| "无法准备 Git 查询缓存")?;
    fs::write(directory.path().join("empty-config"), "").map_err(|_| "无法准备 Git 查询缓存")?;
    let head = read_bounded(&directory.path().join("HEAD"), 1024)?;
    let head = std::str::from_utf8(&head)
        .map_err(|_| "Git HEAD 无效")?
        .trim();
    let branch = head.strip_prefix("ref: refs/heads/").map(str::to_owned);
    if head.starts_with("ref:") && branch.is_none() {
        return Err("Git HEAD 不是本地分支".into());
    }
    if head.contains('\n') || head.contains('\r') {
        return Err("Git HEAD 无效".into());
    }
    Ok(Prepared {
        git: executable(&root)?,
        root,
        directory,
        branch,
        originals,
    })
}
impl Prepared {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.git);
        command
            .env_clear()
            .current_dir(&self.root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for key in ["SYSTEMROOT", "WINDIR", "TMP", "TEMP"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .env("PATH", git_path(self.git.parent().unwrap()))
            .env("HOME", git_path(self.directory.path()))
            .env("XDG_CONFIG_HOME", git_path(self.directory.path()))
            .env("GIT_DIR", git_path(self.directory.path()))
            .env("GIT_COMMON_DIR", git_path(self.directory.path()))
            .env("GIT_WORK_TREE", git_path(&self.root))
            .env(
                "GIT_OBJECT_DIRECTORY",
                git_path(&self.root.join(".git/objects")),
            )
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env(
                "GIT_CONFIG_GLOBAL",
                self.directory.path().join("empty-config"),
            )
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_NO_LAZY_FETCH", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .args([
                "--no-pager",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.untrackedCache=false",
                "-c",
                "color.ui=false",
            ]);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command
    }
}
fn git_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        // Git for Windows does not interpret Win32 verbatim prefixes in environment paths.
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!("//{}", unc.replace('\\', "/"));
        }
        value
            .strip_prefix(r"\\?\")
            .unwrap_or(&value)
            .replace('\\', "/")
    } else {
        value.into_owned()
    }
}
async fn output(mut command: Command, stopped: &AtomicBool) -> Result<Vec<u8>, String> {
    check_stop(stopped)?;
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 Git 查询，请检查 Git 安装")?;
    #[cfg(windows)]
    let tree = match crate::assistant_cli::ProcessTree::attach(child.id().ok_or("Git 查询已退出")?)
    {
        Ok(tree) => Some(tree),
        Err(error) => {
            if child
                .try_wait()
                .map_err(|_| "无法检查 Git 查询进程")?
                .is_some()
            {
                None
            } else {
                let _ = child.kill().await;
                return Err(error);
            }
        }
    };
    async fn bounded(mut stream: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>, String> {
        let mut result = Vec::new();
        // Tauri constructs this nested future on the Windows UI thread's small stack.
        let mut chunk = vec![0u8; 8192];
        loop {
            let count = stream
                .read(&mut chunk)
                .await
                .map_err(|_| "Git 查询输出失败")?;
            if count == 0 {
                return Ok(result);
            }
            if result.len() + count > limit {
                return Err("Git 查询结果超过 256 KiB，请选择更小的文件或工作区".into());
            }
            result.extend_from_slice(&chunk[..count]);
        }
    }
    let stdout = bounded(child.stdout.take().ok_or("Git 输出不可用")?, OUTPUT_LIMIT);
    let stderr = bounded(child.stderr.take().ok_or("Git 输出不可用")?, 16 * 1024);
    let result = tokio::select! {
        result = async {
            let (stdout, _stderr) = tokio::try_join!(stdout, stderr)?;
            let status = child.wait().await.map_err(|_| "Git 查询失败")?;
            if !status.success() { return Err("Git 查询失败；仓库可能正在更新，或使用了尚不支持的存储格式".into()); }
            Ok(stdout)
        } => result,
        _ = async { while !stopped.load(Ordering::SeqCst) { tokio::time::sleep(std::time::Duration::from_millis(25)).await; } } => Err("插件请求已取消".into()),
    };
    // Reap before removing temporary metadata, including errors caused by output limits.
    #[cfg(windows)]
    if let Some(tree) = tree {
        tree.terminate_and_wait().await?;
    }
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}
fn safe_config(config: &[u8]) -> Result<String, String> {
    let config = std::str::from_utf8(config).map_err(|_| "Git 配置编码无效")?;
    let mut result = format!("[core]\n bare = false\n filemode = {}\n", !cfg!(windows));
    for entry in config.split('\0').filter(|entry| !entry.is_empty()) {
        let (key, value) = entry.split_once('\n').unwrap_or((entry, "true"));
        let key = key.to_ascii_lowercase();
        let value = value.to_ascii_lowercase();
        if key.starts_with("extensions.") && key != "extensions.objectformat" {
            return Err("Git 插件暂不支持此仓库扩展格式".into());
        }
        let allowed = match key.as_str() {
            "core.repositoryformatversion" => matches!(value.as_str(), "0" | "1"),
            "core.filemode" | "core.ignorecase" | "core.symlinks" | "core.precomposeunicode" => {
                matches!(value.as_str(), "true" | "false")
            }
            "core.autocrlf" => matches!(value.as_str(), "true" | "false" | "input"),
            "core.eol" => matches!(value.as_str(), "lf" | "crlf" | "native"),
            "extensions.objectformat" => matches!(value.as_str(), "sha1" | "sha256"),
            _ => continue,
        };
        if !allowed {
            return Err("Git 仓库基础配置值无效".into());
        }
        let (section, key) = key.split_once('.').unwrap();
        result.push_str(&format!("[{section}]\n {key} = {value}\n"));
    }
    Ok(result)
}
fn status(bytes: &[u8], branch: &Option<String>) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Git 插件仅支持 UTF-8 文件名")?;
    let mut records = text.split('\0').filter(|row| !row.is_empty());
    let mut entries = Vec::new();
    while let Some(row) = records.next() {
        let bytes = row.as_bytes();
        if bytes.len() < 4
            || bytes[2] != b' '
            || !bytes[0..2].iter().all(|c| b" MADRCU?!T".contains(c))
        {
            return Err("Git 状态格式无效".into());
        }
        let original = if bytes[0..2].iter().any(|c| *c == b'R' || *c == b'C') {
            Some(records.next().ok_or("Git 重命名状态无效")?)
        } else {
            None
        };
        entries.push(json!({"path": &row[3..], "index": &row[0..1], "worktree": &row[1..2], "originalPath": original}));
        if entries.len() > 1000 {
            return Err("Git 状态超过 1000 项，请缩小工作区".into());
        }
    }
    Ok(json!({"branch":branch,"detached":branch.is_none(),"entries":entries}))
}
fn log(bytes: &[u8], path: Option<&str>) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Git 提交历史不是 UTF-8 文本")?;
    let mut commits = Vec::new();
    for record in text
        .split('\u{1e}')
        .filter(|record| !record.is_empty())
        .map(|record| record.trim_end_matches(['\r', '\n']))
    {
        let fields: Vec<_> = record.split('\u{1f}').collect();
        if fields.len() != 4 || fields.iter().any(|field| field.is_empty()) {
            return Err("Git 提交历史格式无效".into());
        }
        let id = fields[0];
        if id.len() != 40 && id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Git 提交标识无效".into());
        }
        commits.push(json!({
            "id": id,
            "shortId": &id[..7.min(id.len())],
            "author": fields[1],
            "date": fields[2],
            "subject": fields[3],
        }));
    }
    Ok(json!({"path": path, "commits": commits}))
}
pub async fn query(
    prepared: &Prepared,
    name: &str,
    args: QueryArgs,
    stopped: &AtomicBool,
) -> Result<Value, String> {
    // Parse a COPY as data; --no-includes prevents config from reading additional files.
    let mut config = prepared.command();
    config
        .args(["config", "--null", "--no-includes", "--file"])
        .arg(prepared.directory.path().join("source-config"))
        .arg("--list");
    let config = safe_config(&output(config, stopped).await?)?;
    fs::write(prepared.directory.path().join("config"), config)
        .map_err(|_| "无法准备 Git 查询配置")?;
    let mut command = prepared.command();
    let result = if name == "git.status" {
        command.args([
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
            "--ignore-submodules=all",
            "--no-renames",
        ]);
        status(&output(command, stopped).await?, &prepared.branch)?
    } else if name == "git.log" {
        command
            .args([
                "log",
                "--no-decorate",
                "--no-renames",
                "--date=iso-strict",
                "--format=%x1e%H%x1f%an%x1f%aI%x1f%s",
                "--max-count",
            ])
            .arg(args.limit.to_string());
        if let Some(path) = args.path.as_deref() {
            crate::storage::validate_relative_path(path, false)?;
            command.args(["--", path]);
        }
        log(&output(command, stopped).await?, args.path.as_deref())?
    } else {
        let path = args.path.as_deref().ok_or("请选择一个文件")?;
        // Missing/deleted files are allowed; no user path is interpreted as an option or pathspec.
        crate::storage::validate_relative_path(path, false)?;
        let mut current = prepared.root.clone();
        for component in Path::new(path).components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(_) => {
                    checked(&prepared.root, &current)?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(_) => return Err("无法验证 Git 文件路径".into()),
            }
        }
        command.args([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--ignore-submodules=all",
            "--no-color",
            "--unified=3",
        ]);
        if args.staged {
            command.arg("--cached");
        }
        command.arg("--").arg(path);
        let patch = String::from_utf8(output(command, stopped).await?)
            .map_err(|_| "Git 差异不是 UTF-8 文本")?;
        json!({"path":path,"staged":args.staged,"patch":patch})
    };
    for (path, hash) in &prepared.originals {
        check_stop(stopped)?;
        if crate::storage::hash(&read_bounded(path, METADATA_LIMIT)?) != *hash {
            return Err("Git 元数据在查询期间发生变化，请重试".into());
        }
    }
    if serde_json::to_vec(&result)
        .map_err(|_| "Git 输出无效")?
        .len()
        > 300 * 1024
    {
        return Err("Git 查询结果过大".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arguments_and_config_cannot_inject_options_helpers_or_external_files() {
        for value in [
            json!({"path":"../outside"}),
            json!({"path":".git/config"}),
            json!({"path":"a.md","extra":"--output=x"}),
        ] {
            assert!(parse_args("git.diff", value).is_err());
        }
        assert!(parse_args("git.status", json!({"path":"a"})).is_err());
        let config = safe_config(b"core.autocrlf\ninput\0core.fsmonitor\nevil\0filter.evil.clean\nevil\0include.path\n/outside\0remote.origin.url\nhttps://evil\0").unwrap();
        assert!(config.contains("autocrlf = input"));
        assert!(!config.contains("evil"));
        assert!(!config.contains("outside"));
        assert!(safe_config(b"core.autocrlf\ntrue\n[filter evil]\0").is_err());
        assert!(safe_config(b"extensions.refstorage\nreftable\0").is_err());
        assert!(parse_args("git.log", json!({"limit": 0})).is_err());
        assert!(parse_args("git.log", json!({"path": "../outside"})).is_err());
    }
    #[test]
    fn parses_unicode_spaces_and_rename_paths_without_splitting_names() {
        let result = status(
            " M 文 件.md\0R  new.md\0old.md\0?? 新.md\0".as_bytes(),
            &Some("main".into()),
        )
        .unwrap();
        assert_eq!(result["entries"][0]["path"], "文 件.md");
        assert_eq!(result["entries"][1]["originalPath"], "old.md");
        assert_eq!(result["entries"][2]["index"], "?");
    }
    fn git(root: &Path, args: &[&str]) {
        let output = std::process::Command::new(executable(root).unwrap())
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[tokio::test]
    async fn real_git_queries_are_read_only_and_ignore_configured_executables_and_includes() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let cache = tempfile::tempdir().unwrap();
        git(&root, &["init"]);
        fs::write(root.join("note.md"), "first\n").unwrap();
        fs::create_dir(root.join("folder")).unwrap();
        fs::write(root.join("folder/deleted.md"), "deleted line\n").unwrap();
        git(&root, &["add", "note.md", "folder/deleted.md"]);
        git(
            &root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "-m",
                "Initial",
            ],
        );
        fs::write(root.join("note.md"), "first\nstaged\n").unwrap();
        git(&root, &["add", "note.md"]);
        fs::write(root.join("note.md"), "first\nstaged\nsecond\n").unwrap();
        fs::remove_file(root.join("folder/deleted.md")).unwrap();
        fs::remove_dir(root.join("folder")).unwrap();
        fs::write(root.join("new.md"), "new\n").unwrap();
        let marker = root.join("helper-ran");
        let helper = format!(
            "echo unsafe > '{}'",
            marker.to_string_lossy().replace('\\', "/")
        );
        git(&root, &["config", "core.fsmonitor", &helper]);
        git(&root, &["config", "filter.evil.clean", &helper]);
        git(&root, &["config", "diff.evil.textconv", &helper]);
        git(&root, &["config", "include.path", "missing-must-not-read"]);
        fs::write(root.join(".gitattributes"), "*.md filter=evil diff=evil\n").unwrap();
        let index_before = fs::read(root.join(".git/index")).unwrap();
        let prepared = prepare(&root, cache.path(), &AtomicBool::new(false)).unwrap();
        let stopped = AtomicBool::new(false);
        let state = query(&prepared, "git.status", QueryArgs::default(), &stopped)
            .await
            .unwrap();
        assert!(state["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["path"] == "note.md" && row["worktree"] == "M"));
        assert!(state["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["path"] == "new.md" && row["index"] == "?"));
        let diff = query(
            &prepared,
            "git.diff",
            parse_args("git.diff", json!({"path":"note.md"})).unwrap(),
            &stopped,
        )
        .await
        .unwrap();
        assert!(diff["patch"].as_str().unwrap().contains("+second"));
        let history = query(
            &prepared,
            "git.log",
            parse_args("git.log", json!({"limit": 10})).unwrap(),
            &stopped,
        )
        .await
        .unwrap();
        assert_eq!(history["commits"][0]["subject"], "Initial");
        let file_history = query(
            &prepared,
            "git.log",
            parse_args("git.log", json!({"path": "note.md", "limit": 10})).unwrap(),
            &stopped,
        )
        .await
        .unwrap();
        assert_eq!(file_history["path"], "note.md");
        let staged = query(
            &prepared,
            "git.diff",
            parse_args("git.diff", json!({"path":"note.md", "staged":true})).unwrap(),
            &stopped,
        )
        .await
        .unwrap();
        assert!(staged["patch"].as_str().unwrap().contains("+staged"));
        assert!(!staged["patch"].as_str().unwrap().contains("+second"));
        let deleted = query(
            &prepared,
            "git.diff",
            parse_args("git.diff", json!({"path":"folder/deleted.md"})).unwrap(),
            &stopped,
        )
        .await
        .unwrap();
        assert!(deleted["patch"].as_str().unwrap().contains("-deleted line"));
        fs::write(root.join("note.md"), "long difference\n".repeat(30000)).unwrap();
        assert!(query(
            &prepared,
            "git.diff",
            parse_args("git.diff", json!({"path":"note.md"})).unwrap(),
            &stopped
        )
        .await
        .unwrap_err()
        .contains("256 KiB"));
        fs::write(root.join("note.md"), "first\nstaged\nsecond\n").unwrap();
        stopped.store(true, Ordering::SeqCst);
        assert!(
            query(&prepared, "git.status", QueryArgs::default(), &stopped)
                .await
                .unwrap_err()
                .contains("取消")
        );
        stopped.store(false, Ordering::SeqCst);
        assert!(!marker.exists());
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), index_before);
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/replaced\n").unwrap();
        assert!(
            query(&prepared, "git.status", QueryArgs::default(), &stopped)
                .await
                .is_err()
        );
    }
    #[test]
    fn rejects_alternates_linked_worktrees_and_cancelled_preparation() {
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        git(dir.path(), &["init"]);
        assert!(prepare(dir.path(), cache.path(), &AtomicBool::new(true)).is_err());
        fs::write(dir.path().join(".git/objects/info/alternates"), "/outside").unwrap();
        assert!(prepare(dir.path(), cache.path(), &AtomicBool::new(false))
            .unwrap_err()
            .contains("共享对象库"));
    }
    #[tokio::test]
    async fn cancellation_reaps_a_running_process_before_returning() {
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        git(dir.path(), &["init"]);
        let stopped = std::sync::Arc::new(AtomicBool::new(false));
        let prepared = prepare(dir.path(), cache.path(), &stopped).unwrap();
        let mut command = prepared.command();
        // Waiting for stdin keeps a real Git process alive without executing a shell/helper.
        command
            .args(["hash-object", "--stdin"])
            .stdin(Stdio::piped());
        let stop = stopped.clone();
        let cancel = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            stop.store(true, Ordering::SeqCst);
        });
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(3), output(command, &stopped))
                .await
                .unwrap();
        assert!(result.unwrap_err().contains("取消"));
        cancel.await.unwrap();
        prepared.directory.close().unwrap();
    }
}
