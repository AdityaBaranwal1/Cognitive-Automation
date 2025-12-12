//! Input Injection Module for Windows
//!
//! Implements keyboard/mouse injection using Windows SendInput API.
//! Key features:
//! - KEY_IGNORE pattern (from AutoHotkey) to prevent hotkey re-triggering
//! - Modifier trap prevention (release modifiers before injection, restore after)
//! - Playwright-style named key mapping
//!
//! Reference: AutoHotkey keyboard_mouse.h, Playwright usKeyboardLayout.ts

#[cfg(target_os = "windows")]
mod windows_impl {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL, VK_LCONTROL, VK_RCONTROL,
        VK_MENU, VK_LMENU, VK_RMENU,
        VK_SHIFT, VK_LSHIFT, VK_RSHIFT,
        VK_LWIN, VK_RWIN,
    };
    use std::mem::size_of;

    /// AutoHotkey's KEY_IGNORE value - marks injected events to be ignored by hooks
    /// Reference: AutoHotkey source/keyboard_mouse.h line 252
    pub const KEY_IGNORE: usize = 0xFFC3D44F;

    /// Modifier state tracking
    #[derive(Debug, Clone, Default)]
    pub struct ModifierState {
        pub ctrl: bool,
        pub alt: bool,
        pub shift: bool,
        pub win: bool,
        pub lctrl: bool,
        pub rctrl: bool,
        pub lalt: bool,
        pub ralt: bool,
        pub lshift: bool,
        pub rshift: bool,
        pub lwin: bool,
        pub rwin: bool,
    }

    /// Maps named keys to Windows Virtual Key codes
    /// Reference: Playwright usKeyboardLayout.ts
    fn map_key_name_to_vk(key: &str) -> Option<(u16, bool)> {
        // Returns (virtual_key_code, is_extended_key)
        match key.to_lowercase().as_str() {
            // Function keys
            "escape" | "esc" => Some((0x1B, false)),
            "f1" => Some((0x70, false)),
            "f2" => Some((0x71, false)),
            "f3" => Some((0x72, false)),
            "f4" => Some((0x73, false)),
            "f5" => Some((0x74, false)),
            "f6" => Some((0x75, false)),
            "f7" => Some((0x76, false)),
            "f8" => Some((0x77, false)),
            "f9" => Some((0x78, false)),
            "f10" => Some((0x79, false)),
            "f11" => Some((0x7A, false)),
            "f12" => Some((0x7B, false)),

            // Navigation
            "insert" => Some((0x2D, true)),
            "delete" => Some((0x2E, true)),
            "home" => Some((0x24, true)),
            "end" => Some((0x23, true)),
            "pageup" | "pgup" => Some((0x21, true)),
            "pagedown" | "pgdn" => Some((0x22, true)),

            // Arrow keys
            "arrowup" | "up" => Some((0x26, true)),
            "arrowdown" | "down" => Some((0x28, true)),
            "arrowleft" | "left" => Some((0x25, true)),
            "arrowright" | "right" => Some((0x27, true)),

            // Control keys
            "enter" | "return" => Some((0x0D, false)),
            "tab" => Some((0x09, false)),
            "backspace" => Some((0x08, false)),
            "space" | " " => Some((0x20, false)),
            "capslock" => Some((0x14, false)),
            "numlock" => Some((0x90, true)),
            "scrolllock" => Some((0x91, false)),
            "pause" => Some((0x13, false)),
            "printscreen" => Some((0x2C, false)),

            // Modifiers (for explicit sending)
            "control" | "ctrl" => Some((0x11, false)),
            "alt" => Some((0x12, false)),
            "shift" => Some((0x10, false)),
            "meta" | "win" | "windows" => Some((0x5B, true)),

            // Numpad
            "numpad0" => Some((0x60, false)),
            "numpad1" => Some((0x61, false)),
            "numpad2" => Some((0x62, false)),
            "numpad3" => Some((0x63, false)),
            "numpad4" => Some((0x64, false)),
            "numpad5" => Some((0x65, false)),
            "numpad6" => Some((0x66, false)),
            "numpad7" => Some((0x67, false)),
            "numpad8" => Some((0x68, false)),
            "numpad9" => Some((0x69, false)),
            "numpadadd" | "numpad+" => Some((0x6B, false)),
            "numpadsubtract" | "numpad-" => Some((0x6D, false)),
            "numpadmultiply" | "numpad*" => Some((0x6A, false)),
            "numpaddivide" | "numpad/" => Some((0x6F, true)),
            "numpaddecimal" | "numpad." => Some((0x6E, false)),
            "numpadenter" => Some((0x0D, true)),

            // Single character (A-Z, 0-9)
            s if s.len() == 1 => {
                let c = s.chars().next().unwrap();
                match c {
                    'a'..='z' => Some((c.to_ascii_uppercase() as u16, false)),
                    'A'..='Z' => Some((c as u16, false)),
                    '0'..='9' => Some((c as u16, false)),
                    _ => None,
                }
            }

            _ => None,
        }
    }

    /// Check if a specific key is currently pressed
    fn is_key_down(vk: u16) -> bool {
        unsafe { (GetAsyncKeyState(vk as i32) & 0x8000u16 as i16) != 0 }
    }

    /// Get the current state of all modifier keys
    /// Reference: AutoHotkey GetModifierLRState() in keyboard_mouse.cpp
    pub fn get_modifier_state() -> ModifierState {
        ModifierState {
            ctrl: is_key_down(VK_CONTROL.0),
            alt: is_key_down(VK_MENU.0),
            shift: is_key_down(VK_SHIFT.0),
            win: is_key_down(VK_LWIN.0) || is_key_down(VK_RWIN.0),
            lctrl: is_key_down(VK_LCONTROL.0),
            rctrl: is_key_down(VK_RCONTROL.0),
            lalt: is_key_down(VK_LMENU.0),
            ralt: is_key_down(VK_RMENU.0),
            lshift: is_key_down(VK_LSHIFT.0),
            rshift: is_key_down(VK_RSHIFT.0),
            lwin: is_key_down(VK_LWIN.0),
            rwin: is_key_down(VK_RWIN.0),
        }
    }

    /// Create a keyboard INPUT struct for SendInput
    fn create_key_input(vk: u16, extended: bool, key_up: bool) -> INPUT {
        let mut flags = windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0);
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }

        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0, // Let Windows determine scan code
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: KEY_IGNORE, // Mark as ignored by our hooks
                },
            },
        }
    }

    /// Send a single key event (down or up)
    fn send_key_event(vk: u16, extended: bool, key_up: bool) -> Result<(), String> {
        let input = create_key_input(vk, extended, key_up);
        let result = unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
        if result == 0 {
            Err(format!("SendInput failed for vk={:#04x}", vk))
        } else {
            Ok(())
        }
    }

    /// Release all currently pressed modifiers
    /// Reference: AutoHotkey SetModifierLRState() pattern
    fn release_modifiers(state: &ModifierState) -> Vec<(u16, bool)> {
        let mut released = Vec::new();

        // Release in order: Ctrl, Alt, Shift, Win
        if state.lctrl {
            let _ = send_key_event(VK_LCONTROL.0, false, true);
            released.push((VK_LCONTROL.0, false));
        }
        if state.rctrl {
            let _ = send_key_event(VK_RCONTROL.0, true, true);
            released.push((VK_RCONTROL.0, true));
        }
        if state.lalt {
            let _ = send_key_event(VK_LMENU.0, false, true);
            released.push((VK_LMENU.0, false));
        }
        if state.ralt {
            let _ = send_key_event(VK_RMENU.0, true, true);
            released.push((VK_RMENU.0, true));
        }
        if state.lshift {
            let _ = send_key_event(VK_LSHIFT.0, false, true);
            released.push((VK_LSHIFT.0, false));
        }
        if state.rshift {
            let _ = send_key_event(VK_RSHIFT.0, false, true);
            released.push((VK_RSHIFT.0, false));
        }
        if state.lwin {
            let _ = send_key_event(VK_LWIN.0, true, true);
            released.push((VK_LWIN.0, true));
        }
        if state.rwin {
            let _ = send_key_event(VK_RWIN.0, true, true);
            released.push((VK_RWIN.0, true));
        }

        released
    }

    /// Restore previously released modifiers
    fn restore_modifiers(released: &[(u16, bool)]) {
        // Restore in reverse order
        for (vk, extended) in released.iter().rev() {
            let _ = send_key_event(*vk, *extended, false);
        }
    }

    /// Press modifiers specified in the list
    fn press_modifiers(modifiers: &[String]) -> Vec<(u16, bool)> {
        let mut pressed = Vec::new();
        
        for m in modifiers {
            let (vk, extended) = match m.to_lowercase().as_str() {
                "ctrl" | "control" => (VK_LCONTROL.0, false),
                "alt" => (VK_LMENU.0, false),
                "shift" => (VK_LSHIFT.0, false),
                "meta" | "win" | "windows" => (VK_LWIN.0, true),
                _ => continue,
            };
            let _ = send_key_event(vk, extended, false);
            pressed.push((vk, extended));
        }
        
        pressed
    }

    /// Release modifiers that were pressed
    fn release_pressed_modifiers(pressed: &[(u16, bool)]) {
        for (vk, extended) in pressed.iter().rev() {
            let _ = send_key_event(*vk, *extended, true);
        }
    }

    /// Send a keypress with modifier trap prevention
    /// 
    /// This function:
    /// 1. Gets current modifier state
    /// 2. Releases all physically held modifiers (prevents Shift+hotkey from typing UPPERCASE)
    /// 3. Presses any specified modifiers
    /// 4. Sends the key down + up
    /// 5. Releases specified modifiers
    /// 6. Restores original modifiers (ALWAYS - per user decision)
    /// 
    /// Reference: AutoHotkey SetModifierLRState() pattern, implementation_plan.md Phase 2
    pub fn send_keypress_safe(key: &str, modifiers: Vec<String>) -> Result<(), String> {
        // 1. Get current modifier state
        let current_mods = get_modifier_state();

        // 2. Release all modifiers that are physically down
        let released = release_modifiers(&current_mods);

        // Small delay to let the system process releases
        std::thread::sleep(std::time::Duration::from_millis(10));

        // 3. Press specified modifiers
        let pressed = press_modifiers(&modifiers);

        // 4. Map key name to virtual key code
        let (vk, extended) = map_key_name_to_vk(key)
            .ok_or_else(|| format!("Unknown key: {}", key))?;

        // 5. Send key down
        send_key_event(vk, extended, false)?;

        // Small delay between down and up
        std::thread::sleep(std::time::Duration::from_millis(10));

        // 6. Send key up
        send_key_event(vk, extended, true)?;

        // 7. Release specified modifiers
        release_pressed_modifiers(&pressed);

        // Small delay before restoring
        std::thread::sleep(std::time::Duration::from_millis(10));

        // 8. Restore original modifiers (ALWAYS)
        restore_modifiers(&released);

        Ok(())
    }

    /// Send a text string by simulating key presses
    pub fn send_text(text: &str) -> Result<(), String> {
        // Get current modifier state
        let current_mods = get_modifier_state();
        let released = release_modifiers(&current_mods);

        std::thread::sleep(std::time::Duration::from_millis(10));

        for c in text.chars() {
            // Map character to key
            if let Some((vk, extended)) = map_key_name_to_vk(&c.to_string()) {
                // Check if we need shift for uppercase
                let needs_shift = c.is_ascii_uppercase();
                
                if needs_shift {
                    send_key_event(VK_LSHIFT.0, false, false)?;
                }
                
                send_key_event(vk, extended, false)?;
                std::thread::sleep(std::time::Duration::from_millis(5));
                send_key_event(vk, extended, true)?;
                
                if needs_shift {
                    send_key_event(VK_LSHIFT.0, false, true)?;
                }
                
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        // Restore original modifiers
        std::thread::sleep(std::time::Duration::from_millis(10));
        restore_modifiers(&released);

        Ok(())
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Send a single keypress with optional modifiers
/// 
/// # Arguments
/// * `key` - Named key like "PageDown", "Enter", "a", "F5"
/// * `modifiers` - Optional list of modifiers: ["ctrl"], ["ctrl", "shift"], etc.
/// 
/// # Safety
/// Uses KEY_IGNORE pattern to prevent triggering our own hotkeys.
/// Implements modifier trap prevention to avoid stuck keys.
#[tauri::command]
pub fn send_keypress(key: String, modifiers: Option<Vec<String>>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::send_keypress_safe(&key, modifiers.unwrap_or_default())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("send_keypress is only supported on Windows".to_string())
    }
}

/// Send a text string by simulating key presses
/// 
/// # Arguments
/// * `text` - Text to type (ASCII characters only for now)
#[tauri::command]
pub fn send_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::send_text(&text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("send_text is only supported on Windows".to_string())
    }
}

/// Get the current state of modifier keys
/// 
/// Returns which modifier keys are currently pressed.
/// Useful for debugging and state inspection.
#[tauri::command]
pub fn get_modifier_state() -> Result<std::collections::HashMap<String, bool>, String> {
    #[cfg(target_os = "windows")]
    {
        let state = windows_impl::get_modifier_state();
        let mut map = std::collections::HashMap::new();
        map.insert("ctrl".to_string(), state.ctrl);
        map.insert("alt".to_string(), state.alt);
        map.insert("shift".to_string(), state.shift);
        map.insert("win".to_string(), state.win);
        map.insert("lctrl".to_string(), state.lctrl);
        map.insert("rctrl".to_string(), state.rctrl);
        map.insert("lalt".to_string(), state.lalt);
        map.insert("ralt".to_string(), state.ralt);
        map.insert("lshift".to_string(), state.lshift);
        map.insert("rshift".to_string(), state.rshift);
        map.insert("lwin".to_string(), state.lwin);
        map.insert("rwin".to_string(), state.rwin);
        Ok(map)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("get_modifier_state is only supported on Windows".to_string())
    }
}
