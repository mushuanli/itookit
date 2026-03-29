use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns the home directory for this session.
///
/// Resolution order:
///   1. CLI argument `--home <path>`
///   2. First positional argument (e.g. `x1 /path/to/project`)
///   3. Current working directory
#[tauri::command]
fn get_home_dir() -> String {
    let args: Vec<String> = std::env::args().collect();

    // --home <path>
    if let Some(idx) = args.iter().position(|a| a == "--home") {
        if let Some(p) = args.get(idx + 1) {
            if !p.starts_with('-') {
                return canonicalise(p);
            }
        }
    }

    // First positional argument that looks like an existing directory
    for arg in args.iter().skip(1) {
        if !arg.starts_with('-') {
            let p = PathBuf::from(arg);
            if p.is_dir() {
                return canonicalise(arg);
            }
        }
    }

    // Fall back to CWD.
    // NOTE: in `tauri dev`, cargo runs the binary from src-tauri/, so CWD is
    // src-tauri rather than the project root.  Pass the desired directory via
    // CLI arg to override:
    //   pnpm tauri:dev -- -- /path/to/project
    //   pnpm tauri:dev -- -- --home /path/to/project
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string())
}

/// Returns the app-local data directory (platform-specific).
///
/// macOS  : ~/Library/Application Support/<bundle_id>/
/// Windows: %APPDATA%\<bundle_id>\
/// Linux  : ~/.local/share/<bundle_id>/
#[tauri::command]
fn get_app_data_dir(app: AppHandle) -> String {
    app.path()
        .app_local_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".tauri-data".to_string())
}

/// Returns the app-config directory.
#[tauri::command]
fn get_app_config_dir(app: AppHandle) -> String {
    app.path()
        .app_config_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".tauri-config".to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn canonicalise(raw: &str) -> String {
    std::fs::canonicalize(raw)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| raw.to_string())
}

// ── Entry point (called from main.rs) ─────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Open DevTools automatically in debug builds (Cmd+Option+I also works)
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            get_app_data_dir,
            get_app_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
