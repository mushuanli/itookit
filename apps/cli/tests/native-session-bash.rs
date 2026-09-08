#[path = "../../tauri-app/src-tauri/src/session_bash.rs"]
mod session_bash;
#[path = "../../tauri-app/src-tauri/src/bash_process.rs"]
mod bash_process;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mounts = [
        session_bash::Mount { source: args[1].clone(), target: "/app".into(), writable: false },
        session_bash::Mount { source: args[2].clone(), target: "/workspace".into(), writable: true },
    ];
    let command = session_bash::command(&args[3], "/workspace", &mounts).unwrap();
    let (stdout, stderr, code) = bash_process::execute_command(
        command, 30_000, &std::sync::atomic::AtomicBool::new(false),
    ).unwrap();
    print!("{stdout}");
    eprint!("{stderr}");
    std::process::exit(if code < 0 { 1 } else { code });
}
