use serde_json::Value;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;

/// Serializes all persistent data writes to prevent concurrent file access races.
/// Without this, rapid IPC calls from React useEffect hooks race on the same
/// temp file, causing "os error 2" (file not found) and "os error 5" (access denied).
pub struct PersistentState {
    pub write_lock: tokio::sync::Mutex<()>,
}

impl Default for PersistentState {
    fn default() -> Self {
        Self {
            write_lock: tokio::sync::Mutex::new(()),
        }
    }
}

/// Validate a persistent-data key:
/// - 1..=128 chars
/// - only [A-Za-z0-9_.-]
///
/// Closes audit finding #19 (unbounded keys could be used for stored-XSS pivots
/// or to fill the persistent-data JSON map with arbitrary garbage).
fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 128 {
        return Err(format!(
            "Invalid persistent-data key: length must be 1..=128 (got {})",
            key.len()
        ));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
    {
        return Err(format!(
            "Invalid persistent-data key: must match ^[A-Za-z0-9_.-]+$"
        ));
    }
    Ok(())
}

/// Get the persistent data file path in the app's data directory.
async fn get_data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&data_dir)
        .await
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    Ok(data_dir.join("persistent_data.json"))
}

/// Save a key-value pair to persistent storage and notify the main window.
///
/// Serialized via Mutex — concurrent calls queue instead of racing on the file.
/// Uses `tokio::fs` so the tokio worker can yield while the disk writes
/// (addresses the prior sync-FS-in-async-fn DoS surface).
///
/// Emits `data-updated` only to the `main` window (audit findings #14, #28 —
/// the key name itself is not broadcast to every webview).
#[tauri::command]
pub async fn save_persistent_data(
    app: AppHandle,
    key: String,
    data: String,
) -> Result<(), String> {
    validate_key(&key)?;

    let state = app.state::<PersistentState>();
    let _guard = state.write_lock.lock().await;

    let path = get_data_file_path(&app).await?;

    let mut map = if fs::try_exists(&path).await.unwrap_or(false) {
        let content = fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read persistent data: {}", e))?;
        serde_json::from_str::<serde_json::Map<String, Value>>(&content).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    let value: Value = serde_json::from_str(&data).unwrap_or(Value::String(data.clone()));
    map.insert(key.clone(), value);

    let tmp_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(&Value::Object(map))
        .map_err(|e| format!("Failed to serialize data: {}", e))?;

    fs::write(&tmp_path, &serialized)
        .await
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    // Push to main + dashboard (the only legitimate listeners), not every webview.
    let _ = app.emit_to("main", "data-updated", &key);
    let _ = app.emit_to("dashboard", "data-updated", &key);

    Ok(())
}

/// Reject filenames containing path-traversal components or absolute paths.
/// Returns the basename (no separators) on success.
///
/// Closes audit finding #5: `download_dir.join(&filename)` previously accepted
/// `..\..\Windows\System32\evil.exe`.
fn sanitize_download_filename(filename: &str) -> Result<String, String> {
    // Reject any separator (forward or back) so the input must be a single basename.
    // `Path::components` collapses `\` differently on Windows vs Linux; checking the
    // raw string is simpler and platform-stable.
    if filename.contains('/') || filename.contains('\\') {
        return Err("Invalid download filename: contains a path separator".to_string());
    }
    let p = Path::new(filename);
    let mut comps = p.components();
    let first = comps.next();
    if comps.next().is_some() {
        return Err("Invalid download filename: must be a single basename".to_string());
    }
    match first {
        Some(Component::Normal(_)) => {}
        _ => return Err("Invalid download filename: not a basename".to_string()),
    }
    let name = p
        .file_name()
        .ok_or_else(|| "Invalid download filename: missing basename".to_string())?
        .to_string_lossy()
        .to_string();
    if name.is_empty() || name == "." || name == ".." {
        return Err("Invalid download filename".to_string());
    }
    Ok(name)
}

/// Save text content to the user's Downloads directory.
/// Returns the full path of the saved file.
#[tauri::command]
pub async fn save_to_downloads(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let safe_name = sanitize_download_filename(&filename)?;

    let download_dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to get downloads dir: {}", e))?;

    fs::create_dir_all(&download_dir)
        .await
        .map_err(|e| format!("Failed to create downloads dir: {}", e))?;

    let file_path = download_dir.join(&safe_name);

    fs::write(&file_path, &content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_key_accepts_simple_keys() {
        assert!(validate_key("workflows").is_ok());
        assert!(validate_key("app-conversation-selected").is_ok());
        assert!(validate_key("a.b_c-1").is_ok());
        assert!(validate_key("X").is_ok());
    }

    #[test]
    fn validate_key_rejects_bad_keys() {
        assert!(validate_key("").is_err());
        assert!(validate_key("with space").is_err());
        assert!(validate_key("__proto__/").is_err());
        assert!(validate_key("key\"with\"quotes").is_err());
        assert!(validate_key(&"x".repeat(129)).is_err());
    }

    #[test]
    fn sanitize_filename_accepts_basenames() {
        assert_eq!(sanitize_download_filename("report.pdf").unwrap(), "report.pdf");
        assert_eq!(sanitize_download_filename("conv-123.md").unwrap(), "conv-123.md");
    }

    #[test]
    fn sanitize_filename_rejects_traversal() {
        assert!(sanitize_download_filename("../evil.exe").is_err());
        assert!(sanitize_download_filename("..\\evil.exe").is_err());
        assert!(sanitize_download_filename("/etc/passwd").is_err());
        assert!(sanitize_download_filename("C:\\Windows\\System32\\x.dll").is_err());
        assert!(sanitize_download_filename("sub/dir/file.txt").is_err());
        assert!(sanitize_download_filename(".").is_err());
        assert!(sanitize_download_filename("..").is_err());
        assert!(sanitize_download_filename("").is_err());
    }
}
