use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// Get the persistent data file path in the app's data directory.
fn get_data_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure the directory exists
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    Ok(data_dir.join("persistent_data.json"))
}

/// Save a key-value pair to persistent storage and notify all windows.
///
/// This is the "Single Source of Truth" for cross-window synchronization.
/// Instead of relying on browser `StorageEvent` (which has TOCTOU races),
/// the Rust backend serializes all writes and pushes updates to both windows.
#[tauri::command]
pub async fn save_persistent_data(
    app: AppHandle,
    key: String,
    data: String,
) -> Result<(), String> {
    let path = get_data_file_path(&app)?;

    // Load existing data (or start fresh)
    let mut map = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read persistent data: {}", e))?;
        serde_json::from_str::<serde_json::Map<String, Value>>(&content).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    // Parse the incoming data as a JSON value (or store as string)
    let value: Value = serde_json::from_str(&data).unwrap_or(Value::String(data.clone()));
    map.insert(key.clone(), value);

    // Write atomically: write to temp file, then rename
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
