use base64::Engine;
use image::codecs::png::PngEncoder;
use image::{ColorType, GenericImageView, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::Emitter;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SelectionCoords {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub monitor_index: usize,
}

#[derive(Debug, Clone)]
pub struct MonitorInfo {
    pub image: image::RgbaImage,
}

/// Inner session data protected by a single RwLock — no more split AtomicBool/Mutex.
pub struct CaptureSession {
    pub overlay_active: bool,
    pub captured_monitors: HashMap<usize, MonitorInfo>,
    pub selection: Option<SelectionCoords>,
}

impl Default for CaptureSession {
    fn default() -> Self {
        Self {
            overlay_active: false,
            captured_monitors: HashMap::new(),
            selection: None,
        }
    }
}

/// All capture state behind a single tokio RwLock + Notify for region selection.
pub struct CaptureState {
    pub session: tokio::sync::RwLock<CaptureSession>,
    pub notify: tokio::sync::Notify,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            session: tokio::sync::RwLock::new(CaptureSession::default()),
            notify: tokio::sync::Notify::new(),
        }
    }
}

#[tauri::command]
pub async fn start_screen_capture(app: tauri::AppHandle) -> Result<(), String> {
    // Get all monitors
    let capture_monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if capture_monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    // Get monitor layout info from Tauri for accurate sizing/positioning
    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitor layout: {}", e))?;

    if tauri_monitors.len() != capture_monitors.len() {
        eprintln!(
            "Monitor count mismatch between capture ({}) and layout ({}); falling back to capture dimensions",
            capture_monitors.len(),
            tauri_monitors.len()
        );
    }

    let state = app.state::<CaptureState>();

    // --- HARDENED: Single write-lock held through the ENTIRE window-building process ---
    // This prevents a second rapid hotkey from passing the overlay_active guard.
    let mut session = state.session.write().await;

    // If already active, clean up stale state first
    if session.overlay_active {
        session.captured_monitors.clear();
        session.overlay_active = false;
        destroy_overlay_windows(&app);
    }

    // Mark active immediately — any concurrent caller will see this and block at .write().await
    session.overlay_active = true;

    // Capture all monitors
    let mut captured = HashMap::new();
    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let captured_image = monitor.capture_image().map_err(|e| {
            session.overlay_active = false;
            format!("Failed to capture monitor {}: {}", idx, e)
        })?;
        captured.insert(idx, MonitorInfo { image: captured_image });
    }
    session.captured_monitors = captured;

    // Clean up any existing overlay windows before creating new ones
    destroy_overlay_windows(&app);

    // Create overlay windows for all monitors — INSIDE the lock
    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let (logical_width, logical_height, logical_x, logical_y) =
            if let Some(display) = tauri_monitors.get(idx) {
                let scale_factor = display.scale_factor();
                let size = display.size();
                let position = display.position();

                let width = size.width as f64 / scale_factor;
                let height = size.height as f64 / scale_factor;
                let x = position.x as f64 / scale_factor;
                let y = position.y as f64 / scale_factor;

                (width, height, x, y)
            } else {
                (
                    monitor.width() as f64,
                    monitor.height() as f64,
                    monitor.x() as f64,
                    monitor.y() as f64,
                )
            };

        let window_label = format!("capture-overlay-{}", idx);

        let overlay =
            WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("index.html".into()))
                .title("Screen Capture")
                .inner_size(logical_width, logical_height)
                .position(logical_x, logical_y)
                .transparent(true)
                .always_on_top(true)
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .closable(false)
                .minimizable(false)
                .maximizable(false)
                .visible(false)
                .focused(true)
                .accept_first_mouse(true)
                .build()
                .map_err(|e| {
                    session.overlay_active = false;
                    format!("Failed to create overlay window {}: {}", idx, e)
                })?;

        tokio::time::sleep(Duration::from_millis(100)).await;

        overlay.show().ok();
        overlay.set_always_on_top(true).ok();

        if monitor.is_primary() {
            overlay.set_focus().ok();
            overlay
                .request_user_attention(Some(tauri::UserAttentionType::Critical))
                .ok();
        }
    }

    // Give a moment for all windows to settle, then focus primary again
    tokio::time::sleep(Duration::from_millis(100)).await;

    for (idx, monitor) in capture_monitors.iter().enumerate() {
        if monitor.is_primary() {
            let window_label = format!("capture-overlay-{}", idx);
            if let Some(window) = app.get_webview_window(&window_label) {
                window.set_focus().ok();
            }
            break;
        }
    }

    // Lock drops here — session is fully initialized, windows are built and visible
    drop(session);

    Ok(())
}

/// Helper: destroy all capture overlay windows (does NOT touch state).
fn destroy_overlay_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }
}

// close overlay window
#[tauri::command]
pub async fn close_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    destroy_overlay_windows(&app);

    // Clear state under write lock
    let state = app.state::<CaptureState>();
    {
        let mut session = state.session.write().await;
        session.captured_monitors.clear();
        session.overlay_active = false;
    }

    // Emit events after lock is dropped
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("capture-closed", ());
    }

    // Notify any waiting tasks to unblock them (with None)
    state.notify.notify_waiters();

    Ok(())
}

#[tauri::command]
pub async fn capture_selected_area(
    app: tauri::AppHandle,
    coords: SelectionCoords,
    monitor_index: usize,
) -> Result<String, String> {
    let state = app.state::<CaptureState>();

    // Extract the monitor image under write lock, then drop lock before heavy work
    let monitor_info = {
        let mut session = state.session.write().await;
        let info = session.captured_monitors.remove(&monitor_index).ok_or_else(|| {
            session.overlay_active = false;
            format!("No captured image found for monitor {}", monitor_index)
        })?;
        session.captured_monitors.clear();
        info
    };

    // Validate coordinates
    if coords.width == 0 || coords.height == 0 {
        return Err("Invalid selection dimensions".to_string());
    }

    let img_width = monitor_info.image.width();
    let img_height = monitor_info.image.height();

    // Ensure coordinates are within bounds
    let x = coords.x.min(img_width.saturating_sub(1));
    let y = coords.y.min(img_height.saturating_sub(1));
    let width = coords.width.min(img_width - x);
    let height = coords.height.min(img_height - y);

    // Crop the image to the selected area
    let cropped = monitor_info.image.view(x, y, width, height).to_image();

    // Encode to PNG and base64
    let mut png_buffer = Vec::new();
    PngEncoder::new(&mut png_buffer)
        .write_image(
            cropped.as_raw(),
            cropped.width(),
            cropped.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|e| format!("Failed to encode to PNG: {}", e))?;

    let base64_str = base64::engine::general_purpose::STANDARD.encode(png_buffer);

    // Close overlay windows
    destroy_overlay_windows(&app);

    // Emit event with base64 data
    app.emit("captured-selection", &base64_str)
        .map_err(|e| format!("Failed to emit captured-selection event: {}", e))?;

    // Reset overlay state
    {
        let mut session = state.session.write().await;
        session.overlay_active = false;
    }

    Ok(base64_str)
}

#[tauri::command]
pub async fn capture_to_base64(window: tauri::WebviewWindow) -> Result<String, String> {
    let monitor_fallback = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let geometry = match (window.outer_position(), window.outer_size()) {
        (Ok(position), Ok(size)) => {
            let width = size.width.min(i32::MAX as u32) as i32;
            let height = size.height.min(i32::MAX as u32) as i32;
            let left = position.x;
            let top = position.y;
            (
                left,
                top,
                left.saturating_add(width),
                top.saturating_add(height),
                left.saturating_add(width / 2),
                top.saturating_add(height / 2),
            )
        }
        _ => {
            if let Some(monitor) = &monitor_fallback {
                let position = monitor.position();
                let size = monitor.size();
                let width = size.width.min(i32::MAX as u32) as i32;
                let height = size.height.min(i32::MAX as u32) as i32;
                let left = position.x;
                let top = position.y;
                (
                    left,
                    top,
                    left.saturating_add(width),
                    top.saturating_add(height),
                    left.saturating_add(width / 2),
                    top.saturating_add(height / 2),
                )
            } else {
                (0, 0, 0, 0, 0, 0)
            }
        }
    };

    let (window_left, window_top, window_right, window_bottom, window_center_x, window_center_y) =
        geometry;

    tauri::async_runtime::spawn_blocking(move || {
        let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
        if monitors.is_empty() {
            return Err("No monitors found".to_string());
        }

        let mut best_idx: Option<usize> = None;
        let mut best_area: i64 = 0;

        for (idx, monitor) in monitors.iter().enumerate() {
            let monitor_left = monitor.x();
            let monitor_top = monitor.y();
            let monitor_right = monitor_left.saturating_add(monitor.width() as i32);
            let monitor_bottom = monitor_top.saturating_add(monitor.height() as i32);

            let overlap_width =
                (window_right.min(monitor_right) - window_left.max(monitor_left)).max(0);
            let overlap_height =
                (window_bottom.min(monitor_bottom) - window_top.max(monitor_top)).max(0);
            let area = (overlap_width as i64) * (overlap_height as i64);

            if area > best_area {
                best_area = area;
                best_idx = Some(idx);
            }
        }

        let target_idx = if let Some(idx) = best_idx {
            idx
        } else {
            let mut closest_idx = 0usize;
            let mut closest_distance = i128::MAX;

            for (idx, monitor) in monitors.iter().enumerate() {
                let monitor_center_x = monitor.x().saturating_add(monitor.width() as i32 / 2);
                let monitor_center_y = monitor.y().saturating_add(monitor.height() as i32 / 2);
                let dx = (window_center_x - monitor_center_x) as i128;
                let dy = (window_center_y - monitor_center_y) as i128;
                let distance = dx * dx + dy * dy;

                if distance < closest_distance {
                    closest_distance = distance;
                    closest_idx = idx;
                }
            }

            closest_idx
        };

        let monitor = monitors
            .into_iter()
            .enumerate()
            .find_map(|(idx, monitor)| {
                if idx == target_idx {
                    Some(monitor)
                } else {
                    None
                }
            })
            .ok_or_else(|| "Failed to determine target monitor".to_string())?;

        let image = monitor
            .capture_image()
            .map_err(|e| format!("Failed to capture image: {}", e))?;
        let mut png_buffer = Vec::new();
        PngEncoder::new(&mut png_buffer)
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                ColorType::Rgba8.into(),
            )
            .map_err(|e| format!("Failed to encode to PNG: {}", e))?;
        let base64_str = base64::engine::general_purpose::STANDARD.encode(png_buffer);

        Ok(base64_str)
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}

#[tauri::command]
pub async fn start_region_selection(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CaptureState>();

    // --- HARDENED: Single write-lock held through the ENTIRE window-building process ---
    let mut session = state.session.write().await;

    // Clear any previous selection
    session.selection = None;

    // If already active, clean up stale state first
    if session.overlay_active {
        session.overlay_active = false;
        destroy_overlay_windows(&app);
    }

    // Mark active — any concurrent caller blocks at .write().await
    session.overlay_active = true;

    let capture_monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
    if capture_monitors.is_empty() {
        session.overlay_active = false;
        return Err("No monitors found".to_string());
    }

    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitor layout: {}", e))?;

    // Create overlay windows — INSIDE the lock
    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let (logical_width, logical_height, logical_x, logical_y) =
            if let Some(display) = tauri_monitors.get(idx) {
                let scale_factor = display.scale_factor();
                let size = display.size();
                let position = display.position();

                let width = size.width as f64 / scale_factor;
                let height = size.height as f64 / scale_factor;
                let x = position.x as f64 / scale_factor;
                let y = position.y as f64 / scale_factor;

                (width, height, x, y)
            } else {
                (
                    monitor.width() as f64,
                    monitor.height() as f64,
                    monitor.x() as f64,
                    monitor.y() as f64,
                )
            };

        let window_label = format!("capture-overlay-{}", idx);

        let overlay =
            WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("index.html".into()))
                .title("Region Selection")
                .inner_size(logical_width, logical_height)
                .position(logical_x, logical_y)
                .transparent(true)
                .always_on_top(true)
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .closable(false)
                .minimizable(false)
                .maximizable(false)
                .visible(false)
                .focused(true)
                .accept_first_mouse(true)
                .build()
                .map_err(|e| {
                    session.overlay_active = false;
                    format!("Failed to create overlay window {}: {}", idx, e)
                })?;

        tokio::time::sleep(Duration::from_millis(100)).await;

        overlay.show().ok();
        overlay.set_always_on_top(true).ok();

        if monitor.is_primary() {
            overlay.set_focus().ok();
            overlay
                .request_user_attention(Some(tauri::UserAttentionType::Critical))
                .ok();
        }
    }

    // Lock drops here — session is fully initialized, windows are built and visible
    drop(session);

    Ok(())
}

#[tauri::command]
pub async fn submit_region_selection(
    app: tauri::AppHandle,
    coords: SelectionCoords,
) -> Result<(), String> {
    let state = app.state::<CaptureState>();

    // Store the selection under write lock
    {
        let mut session = state.session.write().await;
        session.selection = Some(coords);
    }

    // Notify waiting tasks
    state.notify.notify_one();

    // Close the overlay
    let _ = close_overlay_window(app).await;

    Ok(())
}

#[tauri::command]
pub async fn wait_for_region_selection(app: tauri::AppHandle) -> Result<SelectionCoords, String> {
    let state = app.state::<CaptureState>();

    // Wait for notification with timeout (60 seconds)
    let result = tokio::time::timeout(Duration::from_secs(60), state.notify.notified()).await;

    match result {
        Ok(_) => {
            // Notification received — read selection under read lock
            let selection = {
                let session = state.session.read().await;
                session.selection.clone()
            };
            match selection {
                Some(coords) => Ok(coords),
                None => Err("Selection cancelled or failed".to_string()),
            }
        }
        Err(_) => {
            // Timeout
            let _ = close_overlay_window(app).await;
            Err("Selection timed out".to_string())
        }
    }
}

#[tauri::command]
pub async fn capture_area_silent(
    _app: tauri::AppHandle,
    coords: SelectionCoords,
    monitor_index: usize,
) -> Result<String, String> {
    // Get monitors
    let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
    
    let monitor = monitors.get(monitor_index).ok_or_else(|| format!("Monitor index {} out of bounds", monitor_index))?;
    
    // Capture the full monitor image
    let image = monitor.capture_image().map_err(|e| format!("Failed to capture monitor: {}", e))?;
    
    // Validate coordinates
    if coords.width == 0 || coords.height == 0 {
        return Err("Invalid selection dimensions".to_string());
    }

    let img_width = image.width();
    let img_height = image.height();

    // Ensure coordinates are within bounds
    let x = coords.x.min(img_width.saturating_sub(1));
    let y = coords.y.min(img_height.saturating_sub(1));
    let width = coords.width.min(img_width - x);
    let height = coords.height.min(img_height - y);

    // Crop the image to the selected area
    let cropped = image.view(x, y, width, height).to_image();

    // Encode to PNG and base64
    let mut png_buffer = Vec::new();
    PngEncoder::new(&mut png_buffer)
        .write_image(
            cropped.as_raw(),
            cropped.width(),
            cropped.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|e| format!("Failed to encode to PNG: {}", e))?;

    let base64_str = base64::engine::general_purpose::STANDARD.encode(png_buffer);

    Ok(base64_str)
}

#[tauri::command]
pub async fn capture_screen_silent(
    monitor_index: usize,
) -> Result<String, String> {
    // Get monitors
    let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
    
    let monitor = monitors.get(monitor_index).ok_or_else(|| format!("Monitor index {} out of bounds", monitor_index))?;
    
    // Capture the full monitor image
    let image = monitor.capture_image().map_err(|e| format!("Failed to capture monitor: {}", e))?;
    
    // Encode to PNG and base64
    let mut png_buffer = Vec::new();
    PngEncoder::new(&mut png_buffer)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|e| format!("Failed to encode to PNG: {}", e))?;

    let base64_str = base64::engine::general_purpose::STANDARD.encode(png_buffer);

    Ok(base64_str)
}

/// Stitch multiple images vertically into a single image.
///
/// # Memory-Optimized Design (Two-Pass Sequential)
/// - **Pass 1**: Decode each image to read its (width, height), then immediately drop it.
///   This determines max_width and total_height with only ~33MB peak (one 4K image at a time).
/// - **Pass 2**: Allocate the output buffer once, then re-decode each image one at a time,
///   copy via `imageops::overlay`, and drop before loading the next.
///   Peak memory: 1 decoded input + output = ~100MB instead of ~332MB for 5× 4K.
///
/// # Arguments
/// * `images_base64` - Vector of base64-encoded PNG images to stitch
/// * `max_count` - Maximum number of images to stitch (default: 5, prevents memory issues)
/// * `scale_factor` - Scale factor for resizing (0.1-1.0, default: 1.0 = no scaling)
#[tauri::command]
pub async fn stitch_images_vertical(
    images_base64: Vec<String>,
    max_count: Option<u32>,
    scale_factor: Option<f32>,
) -> Result<String, String> {
    let max_count = max_count.unwrap_or(5) as usize;
    let scale_factor = scale_factor.unwrap_or(1.0).clamp(0.1, 1.0);
    let apply_scale = (scale_factor - 1.0).abs() > 0.01;

    if images_base64.is_empty() {
        return Err("No images provided for stitching".to_string());
    }

    // Early exit: single image with no scaling
    if images_base64.len() == 1 && !apply_scale {
        return Ok(images_base64.into_iter().next().unwrap());
    }

    let images_to_stitch: Vec<_> = images_base64.into_iter().take(max_count).collect();

    // --- Pass 1: Dimensions only (decode, measure, drop) ---
    let mut dimensions: Vec<(u32, u32)> = Vec::with_capacity(images_to_stitch.len());

    for (i, b64) in images_to_stitch.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Failed to decode image {}: {}", i, e))?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to parse image {}: {}", i, e))?;

        let (w, h) = if apply_scale {
            (
                (img.width() as f32 * scale_factor) as u32,
                (img.height() as f32 * scale_factor) as u32,
            )
        } else {
            (img.width(), img.height())
        };

        dimensions.push((w, h));
        // `img` dropped here — frees ~33MB per 4K screenshot
    }

    let max_width = dimensions.iter().map(|(w, _)| *w).max().unwrap_or(0);
    let total_height: u32 = dimensions.iter().map(|(_, h)| *h).sum();

    if max_width == 0 || total_height == 0 {
        return Err("Invalid image dimensions".to_string());
    }

    // --- Pass 2: Sequential decode + overlay into pre-allocated output ---
    let mut stitched = image::RgbaImage::new(max_width, total_height);
    let mut y_offset: u32 = 0;

    for (i, b64) in images_to_stitch.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Failed to re-decode image {}: {}", i, e))?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to re-parse image {}: {}", i, e))?;

        let img = if apply_scale {
            let (w, h) = dimensions[i];
            img.resize_exact(w, h, image::imageops::FilterType::Lanczos3)
        } else {
            img
        };

        let rgba = img.to_rgba8();
        let x_offset = (max_width - rgba.width()) / 2;

        // Fast bulk copy instead of per-pixel put_pixel
        image::imageops::overlay(&mut stitched, &rgba, x_offset as i64, y_offset as i64);

        y_offset += rgba.height();
        // `img` and `rgba` dropped here — only one input image in memory at a time
    }

    // Encode to PNG and base64
    let mut png_buffer = Vec::new();
    PngEncoder::new(&mut png_buffer)
        .write_image(
            stitched.as_raw(),
            stitched.width(),
            stitched.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|e| format!("Failed to encode stitched image: {}", e))?;

    let result_base64 = base64::engine::general_purpose::STANDARD.encode(png_buffer);

    Ok(result_base64)
}

