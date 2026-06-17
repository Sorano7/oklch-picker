mod csp;

use csp::CspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load CSP credentials from .env if present.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CspState::default())
        .invoke_handler(tauri::generate_handler![
            csp::csp_connect,
            csp::csp_set_color,
            csp::csp_connected
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
