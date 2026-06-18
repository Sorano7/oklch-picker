mod app_state;
mod csp;

use csp::CspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CspState::default())
        .setup(|app| {
            app_state::restore_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            csp::csp_connect,
            csp::csp_set_color,
            csp::csp_poll_color,
            csp::csp_get_status,
            csp::csp_get_settings,
            csp::csp_save_settings,
            app_state::state_load,
            app_state::state_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
