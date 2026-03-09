// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod capture;
mod db;
mod input; // NEW: Keyboard/mouse input injection
mod shortcuts;
mod window;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
mod persistent;
mod speaker;
use capture::CaptureState;
use speaker::VadConfig;

#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt};

#[derive(Default)]
pub struct AudioState {
    stream_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    vad_config: Arc<Mutex<VadConfig>>,
    is_capturing: Arc<Mutex<bool>>,
    pub cancel_token: CancellationToken,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:auto_vision.db", db::migrations())
                .build(),
        )
        .manage(AudioState::default())
        .manage(CaptureState::default())
        .manage(shortcuts::WindowVisibility {
            is_hidden: Mutex::new(false),
        })
        .manage(shortcuts::RegisteredShortcuts::default())
        .manage(shortcuts::MoveWindowState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_machine_uid::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    #[allow(unused_mut)]
    let mut builder = builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            window::set_window_height,
            window::open_dashboard,
            window::toggle_dashboard,
            window::move_window,
            window::set_content_protection,
            capture::capture_to_base64,
            capture::start_screen_capture,
            capture::capture_selected_area,
            capture::start_region_selection,
            capture::submit_region_selection,
            capture::wait_for_region_selection,
            capture::capture_area_silent,
            capture::capture_screen_silent,
            capture::stitch_images_vertical, // Phase 3: Image stitching
            capture::close_overlay_window,
            shortcuts::check_shortcuts_registered,
            shortcuts::get_registered_shortcuts,
            shortcuts::update_shortcuts,
            shortcuts::register_shortcut,
            shortcuts::unregister_shortcut,
            shortcuts::validate_shortcut_key,
            shortcuts::set_app_icon_visibility,
            shortcuts::set_always_on_top,
            shortcuts::exit_app,
            speaker::start_system_audio_capture,
            speaker::stop_system_audio_capture,
            speaker::manual_stop_continuous,
            speaker::check_system_audio_access,
            speaker::request_system_audio_access,
            speaker::get_vad_config,
            speaker::update_vad_config,
            speaker::get_capture_status,
            speaker::get_audio_sample_rate,
            // Input injection (Windows only)
            input::send_keypress,
            input::send_text,
            input::get_modifier_state,
            // Persistent data sync (cross-window)
            persistent::save_persistent_data,
        ])
        // --- WEBVIEW LIFECYCLE GUARD ---
        // Catches webview reloads (F5, hot-reload, navigation) that would otherwise
        // orphan running audio capture tasks. WindowEvent::Destroyed only fires on
        // window close, not webview reloads.
        .on_page_load(|webview, payload| {
            use tauri::webview::PageLoadEvent;

            // Only act on page-load-started for the main window (reload in progress)
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Started) {
                eprintln!("[lifecycle] Main webview reloading — cancelling audio capture");
                let state = webview.state::<AudioState>();
                // Cancel the token — capture loops will exit via tokio::select!
                state.cancel_token.cancel();
                // Also abort the task directly as safety net
                if let Ok(mut guard) = state.stream_task.lock() {
                    if let Some(task) = guard.take() {
                        task.abort();
                    }
                }
                if let Ok(mut capturing) = state.is_capturing.lock() {
                    *capturing = false;
                };
            }
        })
        .setup(|app| {
            // Setup main window positioning
            window::setup_main_window(app).expect("Failed to setup main window");
            #[cfg(target_os = "macos")]
            init(app.app_handle());

            let app_handle = app.handle();
            if app_handle.get_webview_window("dashboard").is_none() {
                if let Err(e) = window::create_dashboard_window(&app_handle) {
                    eprintln!("Failed to create dashboard window on startup: {}", e);
                }
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                #[allow(deprecated, unexpected_cfgs)]
                if let Err(e) = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                )) {
                    eprintln!("Failed to initialize autostart plugin: {}", e);
                }
            }

            // Initialize global shortcut plugin with centralized handler
            app.handle()
                .plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

                            let action_id = {
                                let state = app.state::<shortcuts::RegisteredShortcuts>();
                                let registered = match state.shortcuts.lock() {
                                    Ok(guard) => guard,
                                    Err(poisoned) => {
                                        eprintln!("Mutex poisoned in handler, recovering...");
                                        poisoned.into_inner()
                                    }
                                };

                                registered.iter().find_map(|(action_id, shortcut_str)| {
                                    if let Ok(s) = shortcut_str.parse::<Shortcut>() {
                                        if &s == shortcut {
                                            return Some(action_id.clone());
                                        }
                                    }
                                    None
                                })
                            };

                            if let Some(action_id) = action_id {
                                match event.state() {
                                    ShortcutState::Pressed => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::start_move_window(app, direction);
                                        } else {
                                            eprintln!("Shortcut triggered: {}", action_id);
                                            shortcuts::handle_shortcut_action(app, &action_id);
                                        }
                                    }
                                    ShortcutState::Released => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::stop_move_window(app, direction);
                                        }
                                    }
                                }
                            }
                        })
                        .build(),
                )
                .expect("Failed to initialize global shortcut plugin");
            if let Err(e) = shortcuts::setup_global_shortcuts(app.handle()) {
                eprintln!("Failed to setup global shortcuts: {}", e);
            }

            // --- VAD Memory Guard: kill audio capture on window destroy ---
            // Lifecycle coverage:
            //   1. on_page_load(PageLoadEvent::Started) — catches F5/hot-reload (above)
            //   2. WindowEvent::Destroyed — catches window close (below)
            // Together these cover all webview teardown paths in Tauri v2.
            let app_handle_for_destroy = app.handle().clone();
            app.get_webview_window("main")
                .expect("main window must exist")
                .on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        let state = app_handle_for_destroy.state::<AudioState>();
                        // Cancel the token — this will cause capture loops to exit
                        state.cancel_token.cancel();
                        // Also abort the task directly as a safety net
                        if let Ok(mut guard) = state.stream_task.lock() {
                            if let Some(task) = guard.take() {
                                task.abort();
                            }
                        }
                        {
                            if let Ok(mut capturing) = state.is_capturing.lock() {
                                *capturing = false;
                            };
                        }
                    }
                });

            Ok(())
        });

    // Add macOS-specific permissions plugin
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn init(app_handle: &AppHandle) {
    let window: WebviewWindow = app_handle.get_webview_window("main").unwrap();

    let panel = window.to_panel().unwrap();

    let delegate = panel_delegate!(MyPanelDelegate {
        window_did_become_key,
        window_did_resign_key
    });

    let handle = app_handle.to_owned();

    delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => {
                let app_name = handle.package_info().name.to_owned();

                println!("[info]: {:?} panel becomes key window!", app_name);
            }
            "window_did_resign_key" => {
                println!("[info]: panel resigned from key window!");
            }
            _ => (),
        }
    }));

    // Set the window to float level
    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    #[allow(deprecated)]
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
    );

    panel.set_delegate(delegate);
}
