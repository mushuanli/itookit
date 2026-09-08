use std::process::{Command, Stdio};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const TRUNCATED: &str = "\n[Bash output truncated at 1048576 bytes]";

pub fn execute(script: &str, cwd: &str, timeout_ms: u64, cancelled: &AtomicBool) -> Result<(String, String, i32), String> {
    execute_command(command(script, cwd), timeout_ms, cancelled)
}

pub fn execute_command(mut command: Command, timeout_ms: u64, cancelled: &AtomicBool) -> Result<(String, String, i32), String> {
    if timeout_ms == 0 || timeout_ms > 2147483647 { return Err("Invalid Bash timeout".into()); }
    if cancelled.load(Ordering::SeqCst) { return Err("Bash command cancelled before start".into()); }
    let mut child = command.spawn().map_err(|e| format!("bash exec failed: {e}"))?;
    let stdout = read_pipe(child.stdout.take());
    let stderr = read_pipe(child.stderr.take());
    let status = wait(&mut child, timeout_ms, cancelled);
    // One-shot execution owns its entire group, including inherited output pipes.
    signal_group(child.id(), "-KILL");
    let _ = child.kill();
    let _ = child.wait();
    let output = stdout.join().map_err(|_| "Bash stdout reader failed")??;
    let errors = stderr.join().map_err(|_| "Bash stderr reader failed")??;
    Ok((output, errors, status?.code().unwrap_or(-1)))
}

fn wait(child: &mut std::process::Child, timeout_ms: u64, cancelled: &AtomicBool) -> Result<std::process::ExitStatus, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { return Ok(status); }
        if cancelled.load(Ordering::SeqCst) || Instant::now() >= deadline {
            signal_group(child.id(), "-TERM");
            std::thread::sleep(Duration::from_millis(100));
            signal_group(child.id(), "-KILL");
            let _ = child.kill();
            return child.wait().map_err(|e| e.to_string());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn signal_group(pid: u32, signal: &str) {
    #[cfg(unix)]
    { let _ = Command::new("kill").args([signal, "--", &format!("-{pid}")]).stdout(Stdio::null()).stderr(Stdio::null()).status(); }
    #[cfg(not(unix))]
    { let _ = (pid, signal); }
}

fn read_pipe<T: Read + Send + 'static>(pipe: Option<T>) -> std::thread::JoinHandle<Result<String, String>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut truncated = false;
        if let Some(mut pipe) = pipe {
            let mut chunk = [0u8; 8192];
            loop {
                let count = match pipe.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(count) => count,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => return Err(format!("Bash output read failed: {error}")),
                };
                let retained = count.min(MAX_CAPTURE_BYTES - bytes.len());
                bytes.extend_from_slice(&chunk[..retained]);
                truncated |= retained < count;
                // Keep draining after the limit so the child cannot block on a full pipe.
            }
        }
        let mut output = String::from_utf8_lossy(&bytes).into_owned();
        if truncated { output.push_str(TRUNCATED); }
        Ok(output)
    })
}

pub fn command(script: &str, cwd: &str) -> Command {
    let mut command = Command::new("bash");
    command.args(["--noprofile", "--norc", "-c", script])
        .env_remove("BASH_ENV")
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executes_bash_syntax_and_preserves_streams_and_exit_status() {
        let cwd = std::env::temp_dir();
        let result = command("items=(first second); printf '%s' \"${items[1]}\"; printf 'diagnostic' >&2; exit 7", cwd.to_str().unwrap())
            .output().unwrap();
        assert_eq!(result.stdout, b"second");
        assert_eq!(result.stderr, b"diagnostic");
        assert_eq!(result.status.code(), Some(7));
    }

    #[test]
    fn runs_nested_bash_in_the_requested_directory() {
        let cwd = std::env::temp_dir();
        let result = command("bash --noprofile --norc -c 'printf \"%s\" \"$PWD\"'", cwd.to_str().unwrap())
            .output().unwrap();
        assert!(result.status.success());
        assert_eq!(String::from_utf8(result.stdout).unwrap(), cwd.canonicalize().unwrap().to_str().unwrap());
    }

    #[test]
    fn timeout_stops_children_that_ignore_term_and_closes_their_pipes() {
        let start = Instant::now();
        let result = execute("trap '' TERM; bash -c 'trap \"\" TERM; while :; do sleep 1; done' & wait",
            std::env::temp_dir().to_str().unwrap(), 50, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.2, -1);
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn bounds_both_streams_while_draining_large_child_output() {
        let script = format!("head -c {} /dev/zero; head -c {} /dev/zero >&2; exit 7",
            MAX_CAPTURE_BYTES * 2, MAX_CAPTURE_BYTES * 2);
        let result = execute(&script, std::env::temp_dir().to_str().unwrap(), 5_000, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.2, 7);
        for output in [result.0, result.1] {
            assert_eq!(output.len(), MAX_CAPTURE_BYTES + TRUNCATED.len());
            assert!(output.ends_with(TRUNCATED));
        }
    }

    #[test]
    fn leaves_small_output_unchanged() {
        let result = execute("printf hello; printf error >&2", std::env::temp_dir().to_str().unwrap(),
            5_000, &AtomicBool::new(false)).unwrap();
        assert_eq!(result, ("hello".into(), "error".into(), 0));
    }

    #[test]
    fn cancellation_stops_a_running_process_group() {
        let cancelled = std::sync::Arc::new(AtomicBool::new(false));
        let signal = cancelled.clone();
        let setter = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            signal.store(true, Ordering::SeqCst);
        });
        let start = Instant::now();
        let result = execute("sleep 30 & wait", std::env::temp_dir().to_str().unwrap(), 30_000, &cancelled).unwrap();
        setter.join().unwrap();
        assert_eq!(result.2, -1);
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
