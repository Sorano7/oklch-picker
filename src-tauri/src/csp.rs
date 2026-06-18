// Clip Studio Paint "Companion Mode" client.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, Manager, State};

const PROTOCOL_VERSION: &str = "1.0";
const APP_VERSION: &str = "G#1:2022.12";
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const AUTH_READ_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Serialize, Deserialize, Clone)]
pub struct CspSettings {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub session_id: String,
}

impl Default for CspSettings {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 32035,
            token: String::new(),
            session_id: String::new(),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct CspStatus {
    pub connected: bool,
    // "Unknown" = authenticated OK; anything else = error detail; empty = never tried.
    pub reason: String,
}

#[derive(Default)]
struct Conn {
    stream: Option<TcpStream>,
    serial: u64,
    auth_reason: String,
    color_index: u8,
}

/// Shared CSP connection handle stored as Tauri managed state.
#[derive(Clone, Default)]
pub struct CspState {
    conn: Arc<Mutex<Conn>>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &tauri::AppHandle) -> CspSettings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string()))
        .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, settings: &CspSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn frame(command: &str, serial: u64, detail: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    let field = |buf: &mut Vec<u8>, sep0: u8, body: &str| {
        buf.push(sep0);
        buf.push(0x24); // '$'
        buf.extend_from_slice(body.as_bytes());
    };
    field(&mut buf, 0x01, &format!("tcp_remote_command_protocol_version={PROTOCOL_VERSION}"));
    field(&mut buf, 0x1e, &format!("command={command}"));
    field(&mut buf, 0x1e, &format!("serial={serial}"));
    field(&mut buf, 0x1e, &format!("detail={detail}"));
    buf.extend_from_slice(&[0x1e, 0x00]);
    buf
}

// Read one CSP message (terminated by 0x1e 0x00) and return AuthErrorReason.
fn read_auth_reason(stream: &mut TcpStream) -> String {
    stream.set_read_timeout(Some(AUTH_READ_TIMEOUT)).ok();
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.len() >= 2 && buf[buf.len() - 2] == 0x1e && *buf.last().unwrap() == 0x00 {
                    break;
                }
            }
        }
    }
    stream.set_read_timeout(None).ok();

    let raw = String::from_utf8_lossy(&buf);
    for segment in raw.split('\x1e') {
        let s = segment.trim_start_matches(|c| c == '\x01' || c == '$');
        if let Some(json_str) = s.strip_prefix("detail=") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(reason) = v.get("AuthErrorReason").and_then(|r| r.as_str()) {
                    return reason.to_string();
                }
            }
        }
    }
    "NoResponse".to_string()
}

fn handle_incoming_frame(data: &[u8], conn: &Arc<Mutex<Conn>>, app: &tauri::AppHandle) {
    let raw = String::from_utf8_lossy(data);
    let mut command = String::new();
    let mut detail_str = String::new();

    for segment in raw.split('\x1e') {
        let s = segment.trim_start_matches(|c: char| c == '\x01' || c == '$');
        if let Some(v) = s.strip_prefix("command=") {
            command = v.to_string();
        } else if let Some(v) = s.strip_prefix("detail=") {
            detail_str = v.to_string();
        }
    }

    if command != "SyncColorCircleUIState" || detail_str.is_empty() {
        return;
    }

    let Ok(detail) = serde_json::from_str::<serde_json::Value>(&detail_str) else {
        return;
    };

    if detail.get("IsCurrentColorTransparent").and_then(|v| v.as_bool()).unwrap_or(false) {
        return;
    }

    let color_index = detail
        .get("CurrentColorIndex")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;

    let from_u32 = |key: &str| -> f64 {
        detail
            .get(key)
            .and_then(|v| v.as_u64())
            .map(|n| n as f64 / 4294967295.0)
            .unwrap_or(0.0)
    };

    let (h, s, l) = if color_index == 0 {
        (from_u32("HLSColorMainH"), from_u32("HLSColorMainS"), from_u32("HLSColorMainL"))
    } else {
        (from_u32("HLSColorSubH"), from_u32("HLSColorSubS"), from_u32("HLSColorSubL"))
    };

    conn.lock().unwrap().color_index = color_index;

    let _ = app.emit("csp-color-changed", json!({ "h": h, "s": s, "l": l, "colorIndex": color_index }));
}

fn read_loop(mut rx: TcpStream, conn: Arc<Mutex<Conn>>, app: tauri::AppHandle) {
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        match rx.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                loop {
                    // Frames are terminated by 0x1e 0x00.
                    match buf.windows(2).position(|w| w[0] == 0x1e && w[1] == 0x00) {
                        None => break,
                        Some(end) => {
                            let frame_data = buf[..end].to_vec();
                            buf.drain(..end + 2);
                            handle_incoming_frame(&frame_data, &conn, &app);
                        }
                    }
                }
            }
        }
    }
}

fn do_connect(conn: Arc<Mutex<Conn>>, settings: CspSettings, app: tauri::AppHandle) -> CspStatus {
    let addr = match format!("{}:{}", settings.host, settings.port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut it| it.next())
    {
        Some(a) => a,
        None => {
            let reason = format!("Cannot resolve {}:{}", settings.host, settings.port);
            conn.lock().unwrap().auth_reason = reason.clone();
            return CspStatus { connected: false, reason };
        }
    };

    let mut stream = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(s) => s,
        Err(e) => {
            let reason = format!("Connection refused: {e}");
            conn.lock().unwrap().auth_reason = reason.clone();
            return CspStatus { connected: false, reason };
        }
    };
    stream.set_nodelay(true).ok();
    stream.set_write_timeout(Some(WRITE_TIMEOUT)).ok();

    let detail = json!([APP_VERSION, settings.token, settings.session_id]).to_string();
    if let Err(e) = stream.write_all(&frame("Authenticate", 0, &detail)) {
        let reason = format!("Send failed: {e}");
        conn.lock().unwrap().auth_reason = reason.clone();
        return CspStatus { connected: false, reason };
    }

    let auth_reason = read_auth_reason(&mut stream);
    let auth_ok = auth_reason == "Unknown";

    if auth_ok {
        if let Ok(rx) = stream.try_clone() {
            let conn_for_reader = Arc::clone(&conn);
            std::thread::spawn(move || read_loop(rx, conn_for_reader, app));
        }
    }

    let mut guard = conn.lock().unwrap();
    guard.stream = if auth_ok { Some(stream) } else { None };
    guard.serial = 1;
    guard.auth_reason = auth_reason.clone();

    CspStatus { connected: auth_ok, reason: auth_reason }
}

/// Open or reopen the connection and authenticate.
#[tauri::command]
pub async fn csp_connect(state: State<'_, CspState>, app: tauri::AppHandle) -> Result<CspStatus, String> {
    let conn = state.conn.clone();
    let settings = load_settings(&app);
    Ok(tauri::async_runtime::spawn_blocking(move || do_connect(conn, settings, app))
        .await
        .map_err(|e| e.to_string())?)
}

/// Set current color; h/s/l are 0.0..=1.0, CSP expects the full u32 range.
#[tauri::command]
pub fn csp_set_color(state: State<CspState>, h: f64, s: f64, l: f64) -> Result<(), String> {
    let to_u32 = |x: f64| -> u64 { (x.clamp(0.0, 1.0) * 4294967295.0).round() as u64 };
    let color_index = state.conn.lock().unwrap().color_index;
    let detail = json!({
        "HLSColorH": to_u32(h),
        "HLSColorS": to_u32(s),
        "HLSColorL": to_u32(l),
        "ColorSpaceKind": "HLS",
        "IsColorTransparent": false,
        "ColorIndex": color_index
    })
    .to_string();

    let mut guard = state.conn.lock().unwrap();
    let serial = guard.serial;
    let msg = frame("SetCurrentColor", serial, &detail);
    let result = match guard.stream.as_mut() {
        Some(stream) => stream.write_all(&msg),
        None => return Err("not connected".to_string()),
    };
    match result {
        Ok(()) => {
            guard.serial += 1;
            Ok(())
        }
        Err(e) => {
            // Drop the dead socket so the frontend can trigger a reconnect.
            guard.stream = None;
            guard.auth_reason = "Disconnected".to_string();
            Err(format!("send: {e}"))
        }
    }
}

/// Send a SyncColorCircleUIState request; the response arrives as a "csp-color-changed" event.
#[tauri::command]
pub fn csp_poll_color(state: State<CspState>) -> Result<(), String> {
    let mut guard = state.conn.lock().unwrap();
    let serial = guard.serial;
    let msg = frame("SyncColorCircleUIState", serial, "");
    let result = match guard.stream.as_mut() {
        Some(stream) => stream.write_all(&msg),
        None => return Err("not connected".to_string()),
    };
    match result {
        Ok(()) => {
            guard.serial += 1;
            Ok(())
        }
        Err(e) => {
            guard.stream = None;
            guard.auth_reason = "Disconnected".to_string();
            Err(format!("send: {e}"))
        }
    }
}

/// Reset CSP's idle timer so it keeps the companion session alive.
#[tauri::command]
pub fn csp_heartbeat(state: State<CspState>) -> Result<(), String> {
    let detail = json!({ "IdleTimerResetRequested": true }).to_string();
    let mut guard = state.conn.lock().unwrap();
    let serial = guard.serial;
    let msg = frame("TellHeartbeat", serial, &detail);
    let result = match guard.stream.as_mut() {
        Some(stream) => stream.write_all(&msg),
        None => return Err("not connected".to_string()),
    };
    match result {
        Ok(()) => {
            guard.serial += 1;
            Ok(())
        }
        Err(e) => {
            guard.stream = None;
            guard.auth_reason = "Disconnected".to_string();
            Err(format!("send: {e}"))
        }
    }
}

#[tauri::command]
pub fn csp_get_status(state: State<CspState>) -> CspStatus {
    let guard = state.conn.lock().unwrap();
    CspStatus {
        connected: guard.stream.is_some(),
        reason: guard.auth_reason.clone(),
    }
}

#[tauri::command]
pub fn csp_get_settings(app: tauri::AppHandle) -> CspSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn csp_save_settings(app: tauri::AppHandle, settings: CspSettings) -> Result<(), String> {
    save_settings(&app, &settings)
}
