use std::{collections::HashMap, path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}, io::Write};
use serde_json::{Value, json};
static NEXT: AtomicU64 = AtomicU64::new(1);
#[derive(Default)]
pub struct DirectoryScopes(pub Mutex<HashMap<String, PathBuf>>);

pub fn directory_open(path: String, state: &DirectoryScopes) -> Result<Value, String> {
    let root = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !root.is_dir() { return Err("selected path is not a directory".into()); }
    let id = NEXT.fetch_add(1, Ordering::Relaxed).to_string();
    state.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), root.clone());
    Ok(json!({"id": id, "root": root.to_string_lossy()}))
}
pub fn directory_close(id: String, state: &DirectoryScopes) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.remove(&id); Ok(())
}
pub fn directory_io(id: String, operation: String, path: String, to: Option<String>, data: Option<Vec<u8>>, state: &DirectoryScopes) -> Result<Value, String> {
    let scopes = state.0.lock().map_err(|e| e.to_string())?;
    let root = scopes.get(&id).ok_or("directory grant has been closed")?;
    let p = crate::directory_boundary::resolve(root, &path)?;
    if p == *root && ["write", "append", "rename"].contains(&operation.as_str()) {
        return Err("cannot mutate grant root".into());
    }
    let err = |e: std::io::Error| e.to_string();
    match operation.as_str() {
        "stat" => {
            let m = match std::fs::metadata(p) { Ok(m) => m, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null), Err(e) => return Err(err(e)) };
            let ms = |t: std::io::Result<std::time::SystemTime>| t.ok().and_then(|v| v.duration_since(std::time::UNIX_EPOCH).ok()).map(|v| v.as_millis() as u64).unwrap_or(0);
            Ok(json!({"size": m.len(), "isDirectory": m.is_dir(), "mtimeMs": ms(m.modified()), "birthtimeMs": ms(m.created())}))
        },
        "exists" => Ok(json!(p.exists())),
        "read" => match std::fs::read(p) { Ok(bytes) => Ok(json!(bytes)), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null), Err(e) => Err(err(e)) },
        "list" => {
            let mut entries = Vec::new();
            for entry in std::fs::read_dir(p).map_err(err)? {
                let entry = entry.map_err(err)?; let kind = entry.file_type().map_err(err)?;
                if !kind.is_symlink() { entries.push(json!({"name": entry.file_name().to_string_lossy(), "isDirectory": kind.is_dir()})); }
            }
            Ok(json!(entries))
        },
        "mkdir" => { std::fs::create_dir_all(p).map_err(err)?; Ok(Value::Null) },
        "write" | "append" => {
            if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).map_err(err)?; }
            let bytes = data.ok_or("missing data")?;
            if operation == "append" {
                let mut file = std::fs::OpenOptions::new().create(true).append(true).open(p).map_err(err)?;
                file.write_all(&bytes).map_err(err)?;
            } else {
                let tmp = p.with_extension(format!("session-tmp-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
                let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(&tmp).map_err(err)?;
                let result = file.write_all(&bytes).and_then(|_| file.sync_all()).and_then(|_| std::fs::rename(&tmp, &p));
                if result.is_err() { let _ = std::fs::remove_file(&tmp); }
                result.map_err(err)?;
            }
            Ok(Value::Null)
        },
        "rename" => { let target = crate::directory_boundary::resolve(root, &to.ok_or("missing destination")?)?; std::fs::rename(p, target).map_err(err)?; Ok(Value::Null) },
        "unlink" | "rmdir" => {
            if p == *root { return Err("cannot remove grant root".into()); }
            let result = if operation == "unlink" { std::fs::remove_file(p) } else { std::fs::remove_dir(p) };
            match result { Ok(()) => Ok(Value::Null), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null), Err(e) => Err(err(e)) }
        },
        _ => Err("unsupported directory operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_io_rejects_escape_and_closed_handles() {
        let root = std::env::temp_dir().join(format!("session-scoped-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let state = DirectoryScopes::default();
        let opened = directory_open(root.to_string_lossy().into(), &state).unwrap();
        let id = opened["id"].as_str().unwrap().to_string();
        directory_io(id.clone(), "write".into(), "test.txt".into(), None, Some(vec![1, 2, 3]), &state).unwrap();
        assert_eq!(directory_io(id.clone(), "read".into(), "test.txt".into(), None, None, &state).unwrap(), json!([1, 2, 3]));
        assert!(directory_io(id.clone(), "read".into(), "../outside".into(), None, None, &state).is_err());
        assert!(directory_io(id.clone(), "rename".into(), "test.txt".into(), Some("../escape".into()), None, &state).is_err());
        assert!(directory_io(id.clone(), "write".into(), "".into(), None, Some(vec![0]), &state).is_err());
        directory_close(id.clone(), &state).unwrap();
        assert!(directory_io(id, "read".into(), "test.txt".into(), None, None, &state).is_err());
        std::fs::remove_file(root.join("test.txt")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
