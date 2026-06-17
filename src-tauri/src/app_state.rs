use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PersistState {
    #[serde(default)]
    pub window: Option<WindowState>,
    pub color: [f64; 3], // [l, c, h]
    pub locked: bool,
    pub always_on_top: bool,
    pub compact: bool,
}

impl Default for PersistState {
    fn default() -> Self {
        PersistState {
            window: None,
            color: [0.72, 0.15, 30.0],
            locked: true,
            always_on_top: true,
            compact: false,
        }
    }
}

fn state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("state.json"))
}

fn load_raw(app: &AppHandle) -> PersistState {
    let Some(path) = state_path(app) else {
        return PersistState::default();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return PersistState::default();
    };
    let Ok(mut s) = serde_json::from_str::<PersistState>(&data) else {
        return PersistState::default();
    };
    let [l, c, h] = s.color;
    if !(0.0..=1.0).contains(&l) || !(0.0..=0.5).contains(&c) || !(0.0..360.0).contains(&h) {
        s.color = [0.72, 0.15, 30.0];
    }
    if let Some(ref ws) = s.window {
        if ws.width < 200 || ws.width > 4000 || ws.height < 200 || ws.height > 4000 {
            s.window = None;
        }
    }
    s
}

// Called from lib.rs setup to restore window geometry before first paint.
pub fn restore_window(app: &AppHandle) {
    let state = load_raw(app);
    let Some(ws) = state.window else { return };
    let Some(win) = app.get_webview_window("main") else { return };
    let _ = win.set_position(PhysicalPosition::new(ws.x, ws.y));
    let _ = win.set_size(PhysicalSize::new(ws.width, ws.height));
}

#[tauri::command]
pub fn state_load(app: AppHandle) -> PersistState {
    load_raw(&app)
}

#[tauri::command]
pub fn state_save(
    app: AppHandle,
    color: [f64; 3],
    locked: bool,
    always_on_top: bool,
    compact: bool,
) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no window".to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;

    let state = PersistState {
        window: Some(WindowState {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        }),
        color,
        locked,
        always_on_top,
        compact,
    };

    let path = state_path(&app).ok_or_else(|| "cannot determine config dir".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
}
