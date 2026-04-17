use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

// ── Settings ──────────────────────────────────────────────────────────────────

struct MindosSettings {
    data_dir: Option<PathBuf>,
    home_dir: Option<PathBuf>,
}

/// Read and parse ~/.mindos/settings.json (or $MINDOS_ROOT/settings.json).
/// Returns defaults (all None) on any read/parse error.
///
/// Supported fields:
///   dataDir  — override where VFS data is stored (default: same dir as settings.json)
///   homeDir  — fix the working project directory (default: CWD)
fn read_settings(base: &PathBuf) -> MindosSettings {
    let Ok(raw) = std::fs::read_to_string(base.join("settings.json")) else {
        return MindosSettings { data_dir: None, home_dir: None };
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return MindosSettings { data_dir: None, home_dir: None };
    };
    MindosSettings {
        data_dir: v["dataDir"].as_str().filter(|s| !s.is_empty()).map(PathBuf::from),
        home_dir: v["homeDir"].as_str().filter(|s| !s.is_empty()).map(PathBuf::from),
    }
}

// ── Path resolution ────────────────────────────────────────────────────────────

/// All resolved runtime paths — computed once in setup(), stored as Tauri State.
/// Commands read from here instead of re-resolving on every call.
struct AppPaths {
    /// Base discovery dir: MINDOS_ROOT env var, or ~/.mindos.
    /// This is always where settings.json lives.
    base_dir:   PathBuf,
    /// Final VFS data dir: base_dir, or settings.json#dataDir if set.
    mindos_dir: PathBuf,
    /// Working project dir opened by the user.
    home_dir:   PathBuf,
}

/// Resolve all runtime paths from env vars, CLI args, and settings.json.
///
/// Resolution order:
///
///   mindos base  : MINDOS_ROOT env var  →  ~/.mindos
///   mindos data  : settings.json#dataDir  →  same as base
///
///   home dir     : --home <path> / positional arg
///                  →  settings.json#homeDir
///                  →  CWD  (unstable — changes with launch directory)
fn resolve_all_paths(system_home: &PathBuf) -> AppPaths {
    // Base dir (where settings.json lives)
    let base_dir = std::env::var("MINDOS_ROOT")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| system_home.join(".mindos"));

    let settings = read_settings(&base_dir);

    // Data dir — may differ from base when settings.json#dataDir is set
    let mindos_dir = settings.data_dir.unwrap_or_else(|| base_dir.clone());

    // Home dir: CLI args take priority; settings.json#homeDir is the stable
    // default; CWD is the last resort (path changes with launch directory,
    // which breaks sidecar DB mapping — set homeDir in settings.json instead)
    let home_dir = resolve_home_from_cli()
        .or(settings.home_dir)
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        });

    AppPaths { base_dir, mindos_dir, home_dir }
}

/// Extract home directory from CLI arguments only (no settings/CWD fallback).
/// Returns None when no CLI home is specified.
fn resolve_home_from_cli() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();

    // --home <path>
    if let Some(idx) = args.iter().position(|a| a == "--home") {
        if let Some(p) = args.get(idx + 1).filter(|p| !p.starts_with('-')) {
            return Some(PathBuf::from(canonicalise(p)));
        }
    }

    // First positional argument that is an existing directory
    for arg in args.iter().skip(1) {
        if !arg.starts_with('-') {
            let p = PathBuf::from(arg);
            if p.is_dir() {
                return Some(PathBuf::from(canonicalise(arg)));
            }
        }
    }

    None
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Working project directory opened by this session.
#[tauri::command]
fn get_home_dir(paths: State<AppPaths>) -> String {
    paths.home_dir.to_string_lossy().into_owned()
}

/// Resolved MindOS VFS data directory.
#[tauri::command]
fn get_mindos_dir(paths: State<AppPaths>) -> String {
    paths.mindos_dir.to_string_lossy().into_owned()
}

#[tauri::command]
fn get_app_data_dir(app: AppHandle) -> String {
    app.path()
        .app_local_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".tauri-data".to_string())
}

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

// ── Entry point ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let system_home = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."));
            let paths = resolve_all_paths(&system_home);

            // Always create the base discovery dir — settings.json lives here
            // even when mindos_dir and base_dir differ.
            let _ = std::fs::create_dir_all(&paths.base_dir);

            // Create the VFS data scaffold in the resolved data dir.
            for sub in &["", "_meta", "_db", "meta", "module"] {
                let _ = std::fs::create_dir_all(paths.mindos_dir.join(sub));
            }
            for module in &[
                "etc", "chats", "agents", "anki",
                "prompts", "projects", "emails", "private",
            ] {
                let _ = std::fs::create_dir_all(paths.mindos_dir.join("module").join(module));
                let _ = std::fs::create_dir_all(paths.mindos_dir.join("_db").join(module));
            }

            // Grant FS plugin runtime access to both directories.
            // The static capability only covers $HOME/**; any path outside it
            // (custom MINDOS_ROOT, homeDir on another mount, etc.) needs this.
            let _ = app.fs_scope().allow_directory(&paths.home_dir, true);
            let _ = app.fs_scope().allow_directory(&paths.mindos_dir, true);

            // Store resolved paths as app state — commands read from here.
            app.manage(paths);

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
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
