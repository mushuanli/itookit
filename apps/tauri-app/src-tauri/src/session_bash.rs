use std::path::{Component, Path};
use std::process::{Command, Stdio};

pub struct Mount {
    pub source: String,
    pub target: String,
    pub writable: bool,
}

/** Build a Linux process namespace from explicit Session directory grants. */
pub fn command(script: &str, cwd: &str, mounts: &[Mount]) -> Result<Command, String> {
    if !cfg!(target_os = "linux") { return Err("Session Bash isolation is not available on this platform".into()); }
    validate_target(cwd)?;
    if !mounts.iter().any(|mount| inside(cwd, &mount.target)) { return Err("Bash cwd has no Session directory grant".into()); }
    let mut sorted: Vec<_> = mounts.iter().collect();
    sorted.sort_by_key(|mount| mount.target.len());
    let mut result = Command::new("bwrap");
    result.args(["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts",
        "--ro-bind", "/usr", "/usr", "--symlink", "/usr/bin", "/bin",
        "--symlink", "/usr/lib", "/lib", "--symlink", "/usr/lib64", "/lib64",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/etc"]);
    for path in ["/etc/resolv.conf", "/etc/hosts", "/etc/ssl", "/etc/ld.so.cache"] {
        if Path::new(path).exists() { result.args(["--ro-bind", path, path]); }
    }
    let mut targets = std::collections::HashSet::new();
    for mount in sorted {
        validate_target(&mount.target)?;
        if !targets.insert(&mount.target) { return Err("Duplicate Session mount target".into()); }
        let source = std::fs::canonicalize(&mount.source).map_err(|e| e.to_string())?;
        if !source.is_dir() { return Err("Session Bash source must be a directory".into()); }
        result.arg(if mount.writable { "--bind" } else { "--ro-bind" }).arg(source).arg(&mount.target);
    }
    result.args(["--chdir", cwd, "--", "bash", "--noprofile", "--norc", "-c", script]);
    result.env_clear().env("PATH", "/usr/local/bin:/usr/bin:/bin").env("HOME", "/tmp").env("LANG", "C.UTF-8");
    result.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    { use std::os::unix::process::CommandExt; result.process_group(0); }
    Ok(result)
}

fn inside(path: &str, root: &str) -> bool { path == root || path.starts_with(&format!("{root}/")) }

fn validate_target(path: &str) -> Result<(), String> {
    if !path.starts_with('/') || path == "/" || path.ends_with('/') || path.contains("//")
        || path.split('/').any(|part| part == "." || part == "..")
        || Path::new(path).components().any(|part| !matches!(part, Component::RootDir | Component::Normal(_))) {
        return Err("Invalid Session Bash path".into());
    }
    if ["/usr", "/bin", "/lib", "/lib64", "/etc", "/proc", "/dev", "/tmp"]
        .iter().any(|root| inside(path, root)) { return Err("Session mount overlaps runtime directories".into()); }
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn confines_bash_to_readonly_and_writable_grants() {
        let root = std::env::temp_dir().join(format!("session-bash-{}", std::process::id()));
        std::fs::create_dir_all(root.join("ro")).unwrap();
        std::fs::create_dir_all(root.join("rw")).unwrap();
        std::fs::write(root.join("ro/input"), "allowed").unwrap();
        std::fs::write(root.join("secret"), "outside").unwrap();
        let mounts = [Mount { source: root.join("ro").to_string_lossy().into(), target: "/input".into(), writable: false },
            Mount { source: root.join("rw").to_string_lossy().into(), target: "/workspace".into(), writable: true }];
        let script = format!("set -e; test ! -e '{}/secret'; if echo denied > /input/new 2>/dev/null; then exit 9; fi; bash -c 'cat /input/input > output'; cat output", root.display());
        let output = command(&script, "/workspace", &mounts).unwrap().output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(output.stdout, b"allowed");
        assert_eq!(std::fs::read(root.join("rw/output")).unwrap(), b"allowed");
        assert!(!root.join("ro/new").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_ungranted_cwd_and_reserved_or_traversing_paths() {
        assert!(command("true", "/workspace", &[]).is_err());
        for path in ["/", "/usr/bin", "/workspace/../etc", "/workspace/", "relative", "/workspace//sub"] {
            assert!(validate_target(path).is_err(), "{path}");
        }
    }
}
