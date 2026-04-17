use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Path resolution ────────────────────────────────────────────────────────────

/// Resolve the final MindOS data directory.
///
/// Resolution order (first match wins):
///   1. `MINDOS_ROOT` env var — sets the base discovery directory
///   2. `<base>/settings.json` → `"dataDir"` field — overrides where data lives
///   3. Default: `~/.mindos`
///
/// Examples:
///   MINDOS_ROOT=/work/my-project      → data at /work/my-project/
///   ~/.mindos/settings.json           → { "dataDir": "/mnt/data/mindos" }
///                                        → data at /mnt/data/mindos/
fn resolve_mindos_dir(home: &PathBuf) -> PathBuf {
    // Step 1: base dir from env or default
    let base = std::env::var("MINDOS_ROOT")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".mindos"));

    // Step 2: optional dataDir override in settings.json
    if let Ok(raw) = std::fs::read_to_string(base.join("settings.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(data_dir) = v["dataDir"].as_str().filter(|s| !s.is_empty()) {
                return PathBuf::from(data_dir);
            }
        }
    }

    base
}

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

    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string())
}

/// Returns the resolved MindOS data directory.
///
/// Respects MINDOS_ROOT env var and settings.json#dataDir.
/// See resolve_mindos_dir() for full resolution order.
#[tauri::command]
fn get_mindos_dir(app: AppHandle) -> String {
    let home = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_mindos_dir(&home)
        .to_string_lossy()
        .into_owned()
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
        .setup(|app| {
            if let Ok(home) = app.path().home_dir() {
                // Always create the base discovery dir (MINDOS_ROOT or ~/.mindos).
                // This is where settings.json lives, even when dataDir points elsewhere.
                let base = std::env::var("MINDOS_ROOT")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join(".mindos"));
                let _ = std::fs::create_dir_all(&base);

                // Create the scaffold in the resolved data dir (may differ from base
                // if settings.json#dataDir is set).
                let mindos = resolve_mindos_dir(&home);
                for sub in &["", "_meta", "_db", "meta", "module"] {
                    let _ = std::fs::create_dir_all(mindos.join(sub));
                }
                for module in &[
                    "etc", "chats", "agents", "anki",
                    "prompts", "projects", "emails", "private",
                ] {
                    let _ = std::fs::create_dir_all(mindos.join("module").join(module));
                    let _ = std::fs::create_dir_all(mindos.join("_db").join(module));
                }
            }

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
            get_mindos_dir,
            get_app_data_dir,
            get_app_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
