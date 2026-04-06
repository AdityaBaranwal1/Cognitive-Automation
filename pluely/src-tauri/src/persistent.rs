use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

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

/// Get the persistent data file path in the app's data directory.
fn get_data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    Ok(data_dir.join("persistent_data.json"))
}

/// Save a key-value pair to persistent storage and notify all windows.
///
/// Serialized via Mutex — concurrent calls queue instead of racing on the file.
#[tauri::command]
pub async fn save_persistent_data(
    app: AppHandle,
    key: String,
    data: String,
) -> Result<(), String> {
    let state = app.state::<PersistentState>();
    let _guard = state.write_lock.lock().await;

    let path = get_data_file_path(&app)?;

    let mut map = if path.exists() {
        let content = fs::read_to_string(&path)
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
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    // Push notification to ALL windows — deterministic cross-window sync
    let _ = app.emit("data-updated", &key);

    Ok(())
}

/// Save text content to the user's Downloads directory.
/// Returns the full path of the saved file.
#[tauri::command]
pub async fn save_to_downloads(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Failed to get downloads dir: {}", e))?;

    fs::create_dir_all(&download_dir)
        .map_err(|e| format!("Failed to create downloads dir: {}", e))?;

    let file_path = download_dir.join(&filename);

    fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
