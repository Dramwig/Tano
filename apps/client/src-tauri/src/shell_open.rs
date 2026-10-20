use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tano_native::storage;
use tauri::{Emitter, Manager};

#[derive(Debug, PartialEq)]
enum Target {
    Workspace(PathBuf),
    Markdown(PathBuf),
}

fn target(args: &[String], cwd: &Path) -> Result<Option<Target>, String> {
    let values = &args[1.min(args.len())..];
    if values.is_empty() {
        return Ok(None);
    }
    let (kind, path) = match values {
        [flag, path] if flag == "--open-folder" || flag == "--open-file" => {
            (Some(flag.as_str()), path)
        }
        [path] if !path.starts_with('-') => (None, path),
        _ => return Err("无法识别打开参数，请选择一个文件夹或 Markdown 文件".into()),
    };
    let path = cwd
        .join(path)
        .canonicalize()
        .map_err(|e| format!("无法打开 {path}：{e}"))?;
    if path.is_dir() && kind != Some("--open-file") {
        Ok(Some(Target::Workspace(path)))
    } else if path.is_file() && markdown(&path) && kind != Some("--open-folder") {
        Ok(Some(Target::Markdown(path)))
    } else {
        Err("请选择文件夹或 .md / .markdown 文件".into())
    }
}

fn markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

fn file_label(path: &Path) -> String {
    format!("file-{}", storage::hash(path.to_string_lossy().as_bytes()))
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
}

#[derive(Clone, serde::Serialize)]
pub struct WorkspaceRequest {
    path: Option<String>,
    error: Option<String>,
}

pub struct ShellState {
    files: Mutex<HashMap<String, PathBuf>>,
    requests: Mutex<VecDeque<WorkspaceRequest>>,
    main: tauri::utils::config::WindowConfig,
}

pub fn prepare(context: &mut tauri::Context<tauri::Wry>) -> ShellState {
    let main = context.config().app.windows[0].clone();
    let state = ShellState {
        files: Mutex::new(HashMap::new()),
        requests: Mutex::new(VecDeque::new()),
        main,
    };
    let args = std::env::args().collect::<Vec<_>>();
    match target(&args, &std::env::current_dir().unwrap_or_default()) {
        Ok(Some(Target::Markdown(path))) => {
            let label = file_label(&path);
            let config = &mut context.config_mut().app.windows[0];
            config.label = label.clone();
            config.url = tauri::WebviewUrl::App("index.html?standalone=1".into());
            state.files.lock().unwrap().insert(label, path);
        }
        Ok(Some(Target::Workspace(path))) => state.enqueue(Some(path), None),
        Err(error) => state.enqueue(None, Some(error)),
        Ok(None) => {}
    }
    state
}

impl ShellState {
    fn enqueue(&self, path: Option<PathBuf>, error: Option<String>) {
        self.requests.lock().unwrap().push_back(WorkspaceRequest {
            path: path.map(|p| display_path(&p)),
            error,
        });
    }
}

fn show(window: &tauri::WebviewWindow) {
    // A second request during cold startup must not reveal an unpainted WebView.
    // startup_ready will reveal it once the frontend has mounted.
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("main") {
        show(&window);
        return Ok(window);
    }
    let state = app.state::<ShellState>();
    let mut config = state.main.clone();
    config.visible = false;
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

pub fn receive(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    let state = app.state::<ShellState>();
    let result = match target(&args, Path::new(&cwd)) {
        Ok(Some(Target::Markdown(path))) => {
            let label = file_label(&path);
            if let Some(window) = app.get_webview_window(&label) {
                show(&window);
                return;
            }
            state.files.lock().unwrap().insert(label.clone(), path);
            let mut config = state.main.clone();
            config.label = label;
            config.visible = false;
            config.url = tauri::WebviewUrl::App("index.html?standalone=1".into());
            tauri::WebviewWindowBuilder::from_config(app, &config)
                .and_then(|builder| builder.build())
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        request => {
            match request {
                Ok(Some(Target::Workspace(path))) => state.enqueue(Some(path), None),
                Err(error) => state.enqueue(None, Some(error)),
                _ => {}
            }
            main_window(app).map(|window| {
                let _ = window.emit("shell-workspace-pending", ());
            })
        }
    };
    if let Err(error) = result {
        state.enqueue(None, Some(error));
        if let Ok(window) = main_window(app) {
            let _ = window.emit("shell-workspace-pending", ());
        }
    }
}

#[tauri::command]
pub fn shell_take_workspace(
    window: tauri::WebviewWindow,
) -> Result<Option<WorkspaceRequest>, String> {
    if window.label() != "main" {
        return Err("仅主窗口可以打开工作区".into());
    }
    Ok(window
        .state::<ShellState>()
        .requests
        .lock()
        .map_err(|e| e.to_string())?
        .pop_front())
}

fn selected_file(window: &tauri::WebviewWindow) -> Result<PathBuf, String> {
    let state = window.state::<ShellState>();
    let files = state.files.lock().map_err(|e| e.to_string())?;
    let path = files.get(window.label()).ok_or("此窗口没有已选文件")?;
    if path.canonicalize().map_err(|e| e.to_string())? != *path {
        return Err("文件路径已被替换，请从资源管理器重新打开".into());
    }
    Ok(path.clone())
}

#[derive(serde::Serialize)]
pub struct OpenFile {
    path: String,
    snapshot: storage::Snapshot,
}

#[tauri::command]
pub fn standalone_read(window: tauri::WebviewWindow) -> Result<OpenFile, String> {
    let path = selected_file(&window)?;
    Ok(OpenFile {
        snapshot: storage::read(&path)?,
        path: display_path(&path),
    })
}

#[tauri::command]
pub fn standalone_write(
    window: tauri::WebviewWindow,
    content: String,
    expected: String,
) -> Result<storage::WriteResult, String> {
    storage::write(&selected_file(&window)?, &content, &expected)
}

#[tauri::command]
pub fn standalone_copy(
    window: tauri::WebviewWindow,
    path: String,
    content: String,
) -> Result<(), String> {
    if !Path::new(&path).is_absolute() || !markdown(Path::new(&path)) {
        return Err("请选择 .md 或 .markdown 文件的完整路径".into());
    }
    // The window must be an authorized standalone editor, even if its original
    // file was deleted. Never overwrite an existing destination or create metadata.
    let state = window.state::<ShellState>();
    if !state
        .files
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(window.label())
    {
        return Err("此窗口没有已选文件".into());
    }
    storage::create(Path::new(&path), &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_quoted_shell_paths_unicode_spaces_and_uppercase_markdown() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("中文 note.MD");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(
            target(
                &["tano".into(), "--open-file".into(), "中文 note.MD".into()],
                dir.path()
            )
            .unwrap(),
            Some(Target::Markdown(file.canonicalize().unwrap()))
        );
        assert_eq!(
            target(
                &[
                    "tano".into(),
                    "--open-folder".into(),
                    dir.path().to_string_lossy().into()
                ],
                dir.path()
            )
            .unwrap(),
            Some(Target::Workspace(dir.path().canonicalize().unwrap()))
        );
        assert!(target(
            &["tano".into(), "--open-file".into(), ".".into()],
            dir.path()
        )
        .is_err());
        assert!(target(
            &["tano".into(), "--open-folder".into(), "中文 note.MD".into()],
            dir.path()
        )
        .is_err());
        assert!(target(&["tano".into(), "missing.md".into()], dir.path()).is_err());
        std::fs::write(dir.path().join("file.exe"), "hello").unwrap();
        assert!(target(&["tano".into(), "file.exe".into()], dir.path()).is_err());
        assert_eq!(target(&["tano".into()], dir.path()).unwrap(), None);
    }
    #[test]
    fn standalone_writes_preserve_external_changes_and_create_no_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "base").unwrap();
        let base = storage::read(&path).unwrap();
        std::fs::write(&path, "external").unwrap();
        assert!(matches!(
            storage::write(&path, "local", &base.hash).unwrap(),
            storage::WriteResult::Conflict { .. }
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external");
        assert!(!dir.path().join(".tano").exists());
    }
}
