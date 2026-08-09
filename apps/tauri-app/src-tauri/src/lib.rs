use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

// ── Settings ──────────────────────────────────────────────────────────────────

struct MindosSettings {
    /// Raw value from settings.json#rootDir — may be relative or absolute.
    root_dir: Option<PathBuf>,
    home_dir: Option<PathBuf>,
}

fn read_settings(base: &PathBuf) -> MindosSettings {
    let Ok(raw) = std::fs::read_to_string(base.join("settings.json")) else {
        return MindosSettings { root_dir: None, home_dir: None };
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return MindosSettings { root_dir: None, home_dir: None };
    };
    MindosSettings {
        root_dir: v["rootDir"].as_str().filter(|s| !s.is_empty()).map(PathBuf::from),
        home_dir: v["homeDir"].as_str().filter(|s| !s.is_empty()).map(PathBuf::from),
    }
}

// ── Path resolution ────────────────────────────────────────────────────────────

struct AppPaths {
    /// Discovery dir: MINDOS_ROOT env var or ~/.mindos. Where settings.json lives.
    base_dir: PathBuf,
    /// Resolved data root. All VFS modules live here (module/, _db/, _meta/).
    /// Defaults to base_dir. Relative paths in settings.json are resolved
    /// against base_dir, making the whole directory portable.
    root_dir: PathBuf,
    home_dir: PathBuf,
}

#[derive(Default)]
struct ShellProcesses(Mutex<HashMap<String, u32>>);

fn resolve_all_paths(system_home: &PathBuf) -> AppPaths {
    let base_dir = std::env::var("MINDOS_ROOT")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| system_home.join(".mindos"));

    let settings = read_settings(&base_dir);

    // rootDir may be:
    //   absent        → root_dir = base_dir (portable default)
    //   relative ("." / "data") → resolved against base_dir (portable)
    //   absolute ("/n/xdr/data") → used as-is (explicit, not portable)
    let root_dir = settings.root_dir
        .map(|rd| {
            if rd.is_absolute() { rd } else { normalize_path(&base_dir.join(&rd)) }
        })
        .unwrap_or_else(|| base_dir.clone());

    let home_dir = resolve_home_from_cli()
        .or(settings.home_dir)
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        });

    AppPaths { base_dir, root_dir, home_dir }
}

fn resolve_home_from_cli() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(idx) = args.iter().position(|a| a == "--home") {
        if let Some(p) = args.get(idx + 1).filter(|p| !p.starts_with('-')) {
            return Some(PathBuf::from(canonicalise(p)));
        }
    }
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

// ── FS commands — bypass plugin-fs scope (dotfiles, NFS, symlinks) ────────────
//
// Tauri's plugin-fs uses glob crate with require_literal_leading_dot=true,
// so `path/**` never matches `path/.hidden`. We expose our own FS commands
// and enforce path security ourselves: every operation must be under
// mindos_dir or home_dir (resolved without following symlinks via normalize_path).

#[derive(serde::Serialize)]
struct FsStatResult {
    size:         u64,
    mtime_ms:     i64,
    birthtime_ms: i64,
    is_directory: bool,
}

#[derive(serde::Serialize)]
struct FsDirEntry {
    name:         String,
    is_directory: bool,
}

/// Normalize a path (resolve `..` and `.`) without requiring it to exist.
/// Prevents directory traversal: `/allowed/dir/../../../etc/passwd` → `/etc/passwd`.
fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => { out.pop(); }
            Component::CurDir    => {}
            other                => out.push(other),
        }
    }
    out
}

fn is_allowed(path: &Path, paths: &AppPaths) -> bool {
    let norm = normalize_path(path);
    norm.starts_with(&paths.root_dir) || norm.starts_with(&paths.home_dir)
}

#[tauri::command]
fn fs_stat(path: String, state: State<AppPaths>) -> Option<FsStatResult> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return None; }
    let m = std::fs::metadata(&p).ok()?;
    let ms = |t: std::time::SystemTime| {
        t.duration_since(std::time::UNIX_EPOCH).ok()
            .map(|d| d.as_millis() as i64).unwrap_or(0)
    };
    Some(FsStatResult {
        size:         m.len(),
        mtime_ms:     m.modified().ok().map(ms).unwrap_or(0),
        birthtime_ms: m.created().ok().map(ms).unwrap_or(0),
        is_directory: m.is_dir(),
    })
}

#[tauri::command]
fn fs_mkdir(path: String, state: State<AppPaths>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_file(path: String, state: State<AppPaths>) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    std::fs::read(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_file(path: String, data: Vec<u8>, state: State<AppPaths>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Atomic write: write to .tmp then rename (POSIX rename is atomic)
    let tmp = p.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn fs_append_file(path: String, data: Vec<u8>, state: State<AppPaths>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).create(true).open(&p)
        .map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_dir(path: String, state: State<AppPaths>) -> Result<Vec<FsDirEntry>, String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    let iter = std::fs::read_dir(&p).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in iter.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_directory = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(FsDirEntry { name, is_directory });
    }
    Ok(out)
}

#[tauri::command]
fn fs_rename(from: String, to: String, state: State<AppPaths>) -> Result<(), String> {
    let (fp, tp) = (PathBuf::from(&from), PathBuf::from(&to));
    if !is_allowed(&fp, &state) || !is_allowed(&tp, &state) {
        return Err("path not allowed".into());
    }
    std::fs::rename(&fp, &tp).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_remove(path: String, recursive: bool, state: State<AppPaths>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {path}")); }
    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if meta.is_dir() {
        if recursive { std::fs::remove_dir_all(&p) } else { std::fs::remove_dir(&p) }
    } else {
        std::fs::remove_file(&p)
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_exists(path: String, state: State<AppPaths>) -> bool {
    let p = PathBuf::from(&path);
    is_allowed(&p, &state) && p.exists()
}

// ── Other commands ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_home_dir(paths: State<AppPaths>) -> String {
    paths.home_dir.to_string_lossy().into_owned()
}

/// Resolved VFS root directory (base for all module data).
/// Defaults to base_dir; can be overridden via settings.json#rootDir.
/// Relative rootDir values are resolved against base_dir, making the
/// whole directory portable across machines.
#[tauri::command]
fn get_root_dir(paths: State<AppPaths>) -> String {
    paths.root_dir.to_string_lossy().into_owned()
}

#[tauri::command]
fn get_app_data_dir(app: AppHandle) -> String {
    app.path().app_local_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".tauri-data".to_string())
}

#[tauri::command]
fn get_app_config_dir(app: AppHandle) -> String {
    app.path().app_config_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".tauri-config".to_string())
}

// ── Native search commands (rg / fd) ──────────────────────────────────────────
//
// These commands expose ripgrep and fd to the Tauri webview, enabling
// INativeShell-backed tools (GrepTool, GlobTool, BashTool) to use native
// binaries instead of manual JS/VFS walking.
//
// Security: all `dir` parameters are validated against is_allowed() before
// passing to the subprocess — same policy as the fs_* commands.
// The spawned commands are limited to rg/fd binaries; no general shell exec.

/// Capabilities advertised to the TS side at startup.
#[derive(serde::Serialize)]
pub struct NativeCapabilities {
    ripgrep: bool,
    fd:      bool,
}

fn which(cmd: &str) -> bool {
    std::process::Command::new(cmd)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Return which native search tools are available.
#[tauri::command]
fn native_capabilities() -> NativeCapabilities {
    NativeCapabilities { ripgrep: which("rg"), fd: which("fd") }
}

/// Run ripgrep and return its raw stdout (JSONL format).
/// The TS layer (TauriNativeShell) parses the JSONL.
#[tauri::command]
fn search_ripgrep(
    pattern:     String,
    dir:         String,
    glob:        Option<String>,
    max_results: Option<u32>,
    state:       State<AppPaths>,
) -> Result<String, String> {
    let p = PathBuf::from(&dir);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {dir}")); }

    let limit = max_results.unwrap_or(50).to_string();
    let exclude_glob = "!{node_modules,dist,.git,.svn,build,out,.next,.nuxt,.cache,coverage,__pycache__}/**";

    let mut cmd = std::process::Command::new("rg");
    cmd.arg("--json")
       .arg("--case-insensitive")
       .arg("--glob").arg(exclude_glob)
       .arg("--max-filesize").arg("1M")
       .arg("--max-count").arg(&limit);

    if let Some(g) = &glob {
        cmd.arg("--glob").arg(g);
    }
    cmd.arg("-e").arg(&pattern).arg(&dir);

    let out = cmd.output().map_err(|e| format!("rg exec failed: {e}"))?;
    // rg exits 1 when no matches found (not an error for us)
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run fd and return its raw stdout (one path per line).
#[tauri::command]
fn search_fd(
    pattern:     String,
    dir:         String,
    max_results: Option<u32>,
    state:       State<AppPaths>,
) -> Result<String, String> {
    let p = PathBuf::from(&dir);
    if !is_allowed(&p, &state) { return Err(format!("path not allowed: {dir}")); }

    let limit = max_results.unwrap_or(100).to_string();

    let out = std::process::Command::new("fd")
        .arg("--type").arg("f")
        .arg("--max-results").arg(&limit)
        .arg("--exclude").arg("node_modules")
        .arg("--exclude").arg("dist")
        .arg("--exclude").arg(".git")
        .arg("--exclude").arg(".svn")
        .arg("--exclude").arg("build")
        .arg("--exclude").arg("out")
        .arg("--exclude").arg(".next")
        .arg("--exclude").arg(".nuxt")
        .arg("--exclude").arg(".cache")
        .arg("--exclude").arg("coverage")
        .arg("--exclude").arg("__pycache__")
        .arg("--glob").arg(&pattern)
        .arg(&dir)
        .output()
        .map_err(|e| format!("fd exec failed: {e}"))?;

    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Execute an arbitrary shell command via sh -c.
/// Only allowed when dir passes is_allowed(); command content is NOT filtered here —
/// the TS BLOCKED_PATTERNS check in BashTool.validateInput() is the safety gate.
#[tauri::command]
fn shell_exec(
    command: String,
    cwd:     String,
    timeout_ms: Option<u64>,
    request_id: String,
    state:   State<AppPaths>,
    processes: State<ShellProcesses>,
) -> Result<(String, i32), String> {
    let p = PathBuf::from(&cwd);
    if !is_allowed(&p, &state) { return Err(format!("cwd not allowed: {cwd}")); }

    let mut command_builder = Command::new("sh");
    command_builder
        .arg("-c").arg(&command)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command_builder.process_group(0);
    let mut child = command_builder.spawn().map_err(|e| format!("sh exec failed: {e}"))?;
    let pid = child.id();
    processes.0.lock().map_err(|_| "shell process lock poisoned")?
        .insert(request_id.clone(), pid);
    let stdout = read_pipe(child.stdout.take());
    let stderr = read_pipe(child.stderr.take());
    let status = wait_for_shell(&mut child, timeout_ms.unwrap_or(30_000), pid);
    processes.0.lock().map_err(|_| "shell process lock poisoned")?.remove(&request_id);
    let output = stdout.join().unwrap_or_default() + &stderr.join().unwrap_or_default();
    Ok((output, status?.code().unwrap_or(-1)))
}

#[tauri::command]
fn shell_cancel(request_id: String, processes: State<ShellProcesses>) -> Result<(), String> {
    let pid = processes.0.lock().map_err(|_| "shell process lock poisoned")?
        .get(&request_id).copied();
    if let Some(pid) = pid { terminate_process_group(pid); }
    Ok(())
}

fn read_pipe<T: Read + Send + 'static>(pipe: Option<T>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut output = String::new();
        if let Some(mut value) = pipe { let _ = value.read_to_string(&mut output); }
        output
    })
}

fn wait_for_shell(
    child: &mut std::process::Child,
    timeout_ms: u64,
    pid: u32,
) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { return Ok(status); }
        if Instant::now() >= deadline {
            terminate_process_group(pid);
            std::thread::sleep(Duration::from_millis(100));
            let _ = child.kill();
            return child.wait().map_err(|e| e.to_string());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn terminate_process_group(pid: u32) {
    let _ = Command::new("kill").arg("-TERM").arg(format!("-{pid}")).status();
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

            let _ = std::fs::create_dir_all(&paths.base_dir);
            for sub in &["", "_meta", "_db", "meta", "module"] {
                let _ = std::fs::create_dir_all(paths.root_dir.join(sub));
            }
            for module in &[
                "etc", "chats", "agents", "anki",
                "prompts", "projects", "emails", "private",
            ] {
                let _ = std::fs::create_dir_all(paths.root_dir.join("module").join(module));
                let _ = std::fs::create_dir_all(paths.root_dir.join("_db").join(module));
            }

            // Keep plugin-fs scope for any direct plugin-fs usage elsewhere.
            // Our TauriFsOps now uses Rust commands (fs_*) instead, so these
            // scope entries are only a fallback / belt-and-suspenders.
            let _ = app.fs_scope().allow_directory(&paths.home_dir, true);
            let _ = app.fs_scope().allow_directory(&paths.root_dir, true);

            app.manage(paths);
            app.manage(ShellProcesses::default());

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
            get_root_dir,
            get_app_data_dir,
            get_app_config_dir,
            fs_stat,
            fs_mkdir,
            fs_read_file,
            fs_write_file,
            fs_append_file,
            fs_read_dir,
            fs_rename,
            fs_remove,
            fs_exists,
            // Native search commands for INativeShell
            native_capabilities,
            search_ripgrep,
            search_fd,
            shell_exec,
            shell_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
