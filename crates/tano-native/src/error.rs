use std::fmt;

/// Structured internal error for `tano-native`.
///
/// Tauri IPC commands convert `NativeError` to `String` via [`From<NativeError> for String`]
/// so the wire format (`Result<T, String>`) and localized client messages remain
/// strictly backwards-compatible.
#[derive(Debug)]
pub enum NativeError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    InvalidPath(&'static str),
    SymlinkEscape(&'static str),
    WorkspaceNotOpen,
    WorkspaceSwitched(&'static str),
    NotFound(&'static str),
    AlreadyExists(&'static str),
    UnsupportedFormat(&'static str),
    SizeLimit(&'static str),
    InvalidEncoding(&'static str),
    InvalidUrl(&'static str),
    PlatformUnavailable(&'static str),
    Message(String),
}

pub type NativeResult<T> = Result<T, NativeError>;

impl NativeError {
    pub fn to_client_message(&self) -> String {
        self.to_string()
    }
}

impl fmt::Display for NativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Sqlite(error) => write!(f, "{error}"),
            Self::Json(error) => write!(f, "{error}"),
            Self::InvalidPath(message)
            | Self::SymlinkEscape(message)
            | Self::WorkspaceSwitched(message)
            | Self::NotFound(message)
            | Self::AlreadyExists(message)
            | Self::UnsupportedFormat(message)
            | Self::SizeLimit(message)
            | Self::InvalidEncoding(message)
            | Self::InvalidUrl(message)
            | Self::PlatformUnavailable(message) => f.write_str(message),
            Self::WorkspaceNotOpen => f.write_str("请先打开一个工作空间"),
            Self::Message(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for NativeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Sqlite(error) => Some(error),
            Self::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for NativeError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for NativeError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for NativeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<String> for NativeError {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

impl From<&str> for NativeError {
    fn from(message: &str) -> Self {
        Self::Message(message.to_owned())
    }
}

impl From<NativeError> for String {
    fn from(error: NativeError) -> Self {
        error.to_client_message()
    }
}
