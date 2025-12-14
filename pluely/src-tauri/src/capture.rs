use base64::Engine;
use image::codecs::png::PngEncoder;
use image::{ColorType, GenericImageView, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::{thread, time::Duration};
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

// Store captured images from all monitors temporarily for cropping
pub struct CaptureState {
    pub captured_monitors: Arc<Mutex<HashMap<usize, MonitorInfo>>>,
    pub overlay_active: Arc<AtomicBool>,
    // Async synchronization for region selection
    pub selection: Arc<tokio::sync::Mutex<Option<SelectionCoords>>>,
    pub notify: Arc<tokio::sync::Notify>,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            captured_monitors: Arc::default(),
            overlay_active: Arc::new(AtomicBool::new(false)),
            selection: Arc::new(tokio::sync::Mutex::new(None)),
            notify: Arc::new(tokio::sync::Notify::new()),
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
    if state.overlay_active.load(Ordering::SeqCst) {
        // Attempt to clean up any stale overlays before proceeding
        let _ = close_overlay_window(app.clone());
    }
    state.overlay_active.store(true, Ordering::SeqCst);
    let mut captured_monitors = HashMap::new();

    // Capture all monitors and store their info
    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let captured_image = monitor.capture_image().map_err(|e| {
            state.overlay_active.store(false, Ordering::SeqCst);
            format!("Failed to capture monitor {}: {}", idx, e)
        })?;

        let monitor_info = MonitorInfo {
            image: captured_image,
        };

        captured_monitors.insert(idx, monitor_info);
    }

    // Store all captured monitors
    *state.captured_monitors.lock().unwrap() = captured_monitors;

    // Clean up any existing overlay windows before creating new ones
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }

    // Create overlay windows for all monitors
    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let (logical_width, logical_height, logical_x, logical_y) =
            if let Some(display) = tauri_monitors.get(idx) {
                let scale_factor = display.scale_factor();
                let size = display.size();
                let position = display.position();

                // Size values are in physical pixels; convert to logical units for window placement
                let width = size.width as f64 / scale_factor;
                let height = size.height as f64 / scale_factor;
                let x = position.x as f64 / scale_factor;
                let y = position.y as f64 / scale_factor;

                (width, height, x, y)
            } else {
                // Fallback to xcap monitor info if Tauri monitor data is unavailable/mismatched
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
                    state.overlay_active.store(false, Ordering::SeqCst);
                    format!("Failed to create overlay window {}: {}", idx, e)
                })?;

        // Wait a short moment for content to load before showing
        thread::sleep(Duration::from_millis(100));

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
    std::thread::sleep(std::time::Duration::from_millis(100));

    for (idx, monitor) in capture_monitors.iter().enumerate() {
        if monitor.is_primary() {
            let window_label = format!("capture-overlay-{}", idx);
            if let Some(window) = app.get_webview_window(&window_label) {
                window.set_focus().ok();
            }
            break;
        }
    }

    Ok(())
}

// close overlay window
#[tauri::command]
pub fn close_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    // Get all webview windows and close those that are capture overlays
    let webview_windows = app.webview_windows();

    for (label, window) in webview_windows.iter() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }

    // Clear captured monitors from state
    let state = app.state::<CaptureState>();
    state.captured_monitors.lock().unwrap().clear();
    state.overlay_active.store(false, Ordering::SeqCst);

    // Emit an event to the main window to signal that the overlay has been closed
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.emit("capture-closed", ()).unwrap();
    }
    
    // Also notify any waiting tasks to unblock them (with None)
    state.notify.notify_waiters();

    Ok(())
}

#[tauri::command]
pub async fn capture_selected_area(
    app: tauri::AppHandle,
    coords: SelectionCoords,
    monitor_index: usize,
) -> Result<String, String> {
    // Get the stored captured monitors
    let state = app.state::<CaptureState>();
    let mut captured_monitors = state.captured_monitors.lock().unwrap();

    let monitor_info = captured_monitors.remove(&monitor_index).ok_or({
        state.overlay_active.store(false, Ordering::SeqCst);
        format!("No captured image found for monitor {}", monitor_index)
    })?;

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

    captured_monitors.clear();
    drop(captured_monitors);

    // Close all overlay windows
    let webview_windows = app.webview_windows();
    for (label, window) in webview_windows.iter() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }

    // Emit event with base64 data
    app.emit("captured-selection", &base64_str)
        .map_err(|e| format!("Failed to emit captured-selection event: {}", e))?;

    state.overlay_active.store(false, Ordering::SeqCst);

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
    // Clear any previous selection
    let state = app.state::<CaptureState>();
    *state.selection.lock().await = None;

    // Reuse the overlay creation logic from select_region_coordinates
    // But we don't need to duplicate the code if we just call the same logic.
    // However, select_region_coordinates was just opening the window.
    // Let's copy the logic here or refactor. 
    // For safety and to avoid deleting code, I'll implement the overlay opening logic here again
    // effectively replacing select_region_coordinates's purpose but with the new name.
    
    // Get all monitors
    let capture_monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if capture_monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    // Get monitor layout info from Tauri for accurate sizing/positioning
    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitor layout: {}", e))?;

    if state.overlay_active.load(Ordering::SeqCst) {
        let _ = close_overlay_window(app.clone());
    }
    state.overlay_active.store(true, Ordering::SeqCst);
    
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
                    state.overlay_active.store(false, Ordering::SeqCst);
                    format!("Failed to create overlay window {}: {}", idx, e)
                })?;

        thread::sleep(Duration::from_millis(100));

        overlay.show().ok();
        overlay.set_always_on_top(true).ok();

        if monitor.is_primary() {
            overlay.set_focus().ok();
            overlay
                .request_user_attention(Some(tauri::UserAttentionType::Critical))
                .ok();
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn submit_region_selection(
    app: tauri::AppHandle,
    coords: SelectionCoords,
) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    
    // Store the selection
    *state.selection.lock().await = Some(coords);
    
    // Notify waiting tasks
    state.notify.notify_one();
    
    // Close the overlay
    let _ = close_overlay_window(app);
    
    Ok(())
}

#[tauri::command]
pub async fn wait_for_region_selection(app: tauri::AppHandle) -> Result<SelectionCoords, String> {
    let state = app.state::<CaptureState>();
    
    // Wait for notification with timeout (e.g. 60 seconds)
    // We use tokio::time::timeout
    let result = tokio::time::timeout(Duration::from_secs(60), state.notify.notified()).await;
    
    match result {
        Ok(_) => {
            // Notification received
            let selection = state.selection.lock().await.clone();
            match selection {
                Some(coords) => Ok(coords),
                None => Err("Selection cancelled or failed".to_string()),
            }
        }
        Err(_) => {
            // Timeout
            let _ = close_overlay_window(app);
            Err("Selection timed out".to_string())
        }
    }
}

#[tauri::command]
pub async fn capture_area_silent(
    app: tauri::AppHandle,
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

/// Stitch multiple images vertically into a single image
/// 
/// # Arguments
/// * `images_base64` - Vector of base64-encoded PNG images to stitch
/// * `max_count` - Maximum number of images to stitch (default: 5, prevents memory issues)
/// * `scale_factor` - Scale factor for resizing (0.0-1.0, default: 1.0 = no scaling)
/// 
/// # Returns
/// Single base64-encoded PNG of the stitched result
/// 
/// # Design Notes
/// - Early exit if only 1 image (just returns it unchanged)
/// - Compatible with loop accumulation (Phase 4) - accepts any number of images
/// - Downscales if scale_factor < 1.0 to reduce memory usage
#[tauri::command]
pub async fn stitch_images_vertical(
    images_base64: Vec<String>,
    max_count: Option<u32>,
    scale_factor: Option<f32>,
) -> Result<String, String> {
    // Apply defaults
    let max_count = max_count.unwrap_or(5) as usize;
    let scale_factor = scale_factor.unwrap_or(1.0).clamp(0.1, 1.0);
    
    // Early exit: no images
    if images_base64.is_empty() {
        return Err("No images provided for stitching".to_string());
    }
    
    // Early exit: single image, just return it (optionally scaled)
    if images_base64.len() == 1 {
        if (scale_factor - 1.0).abs() < 0.01 {
            return Ok(images_base64.into_iter().next().unwrap());
        }
        // Fall through to apply scaling
    }
    
    // Limit number of images
    let images_to_stitch: Vec<_> = images_base64.into_iter().take(max_count).collect();
    
    // Decode all images
    let mut decoded_images: Vec<image::DynamicImage> = Vec::with_capacity(images_to_stitch.len());
    
    for (i, base64_str) in images_to_stitch.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64_str)
            .map_err(|e| format!("Failed to decode image {}: {}", i, e))?;
        
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to parse image {}: {}", i, e))?;
        
        // Apply scaling if needed
        let img = if (scale_factor - 1.0).abs() > 0.01 {
            let new_width = (img.width() as f32 * scale_factor) as u32;
            let new_height = (img.height() as f32 * scale_factor) as u32;
            img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
        } else {
            img
        };
        
        decoded_images.push(img);
    }
    
    // Calculate total dimensions (all images must have same width, or we use max width)
    let max_width = decoded_images.iter().map(|img| img.width()).max().unwrap_or(0);
    let total_height: u32 = decoded_images.iter().map(|img| img.height()).sum();
    
    if max_width == 0 || total_height == 0 {
        return Err("Invalid image dimensions".to_string());
    }
    
    // Create the stitched image
    let mut stitched = image::RgbaImage::new(max_width, total_height);
    
    let mut y_offset: u32 = 0;
    for img in decoded_images {
        let rgba = img.to_rgba8();
        
        // Center horizontally if image is narrower than max_width
        let x_offset = (max_width - rgba.width()) / 2;
        
        // Copy pixels
        for (x, y, pixel) in rgba.enumerate_pixels() {
            if x + x_offset < max_width && y + y_offset < total_height {
                stitched.put_pixel(x + x_offset, y + y_offset, *pixel);
            }
        }
        
        y_offset += rgba.height();
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

