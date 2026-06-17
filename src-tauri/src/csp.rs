// Clip Studio Paint "Companion Mode" client.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use tauri::State;

const PROTOCOL_VERSION: &str = "1.0";
const APP_VERSION: &str = "G#1:2022.12";
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
struct Conn {
    stream: Option<TcpStream>,
    serial: u64,
}

/// Shared CSP connection handle stored as Tauri managed state.
#[derive(Clone, Default)]
pub struct CspState {
    conn: Arc<Mutex<Conn>>,
}

struct Config {
    host: String,
    port: u16,
    token: String,
    session_id: String,
}

fn load_config() -> Result<Config, String> {
    let port: u16 = std::env::var("CSP_PORT")
        .map_err(|_| "CSP_PORT not set in .env".to_string())?
        .trim()
        .parse()
        .map_err(|_| "CSP_PORT in .env is not a valid port number".to_string())?;
    let token = std::env::var("CSP_TOKEN").map_err(|_| "CSP_TOKEN not set in .env".to_string())?;
    let session_id = std::env::var("CSP_SESSION_ID").map_err(|_| "CSP_SESSION_ID not set in .env".to_string())?;
    let host = std::env::var("CSP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    Ok(Config {
        host,
        port,
        token,
        session_id,
    })
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

fn connect_blocking(conn: &Mutex<Conn>) -> Result<(), String> {
    let cfg = load_config()?;
    let addr = format!("{}:{}", cfg.host, cfg.port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve {}:{}: {e}", cfg.host, cfg.port))?
        .next()
        .ok_or_else(|| "could not resolve CSP address".to_string())?;

    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("connect {addr}: {e}"))?;
    stream.set_nodelay(true).ok();
    stream.set_write_timeout(Some(WRITE_TIMEOUT)).ok();

    if let Ok(mut rx) = stream.try_clone() {
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            loop {
                match rx.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
    }

    let detail = json!([APP_VERSION, cfg.token, cfg.session_id]).to_string();
    stream
        .write_all(&frame("Authenticate", 0, &detail))
        .map_err(|e| format!("authenticate: {e}"))?;

    let mut guard = conn.lock().unwrap();
    guard.stream = Some(stream);
    guard.serial = 1;
    Ok(())
}

/// Open or reopen the connection and authenticate.
#[tauri::command]
pub async fn csp_connect(state: State<'_, CspState>) -> Result<(), String> {
    let conn = state.conn.clone();
    // The connect + handshake is blocking; keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || connect_blocking(&conn))
        .await
        .map_err(|e| e.to_string())?
}

/// Set current color; h/s/l are 0.0..=1.0, CSP expects the full u32 range.
#[tauri::command]
pub fn csp_set_color(state: State<CspState>, h: f64, s: f64, l: f64) -> Result<(), String> {
    let to_u32 = |x: f64| -> u64 { (x.clamp(0.0, 1.0) * 4294967295.0).round() as u64 };
    let detail = json!({
        "HLSColorH": to_u32(h),
        "HLSColorS": to_u32(s),
        "HLSColorL": to_u32(l),
        "ColorSpaceKind": "HLS",
        "IsColorTransparent": false,
        "ColorIndex": 0
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
            Err(format!("send: {e}"))
        }
    }
}

#[tauri::command]
pub fn csp_connected(state: State<CspState>) -> bool {
    state.conn.lock().unwrap().stream.is_some()
}
