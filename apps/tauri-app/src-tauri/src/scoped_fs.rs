use tauri::State;
use serde_json::Value;
pub use crate::scoped_directory::DirectoryScopes;

#[tauri::command]
pub fn directory_open(path: String, state: State<DirectoryScopes>) -> Result<Value, String> {
    crate::scoped_directory::directory_open(path, &state)
}
#[tauri::command]
pub fn directory_close(id: String, state: State<DirectoryScopes>) -> Result<(), String> {
    crate::scoped_directory::directory_close(id, &state)
}
#[tauri::command]
pub fn directory_io(id: String, operation: String, path: String, to: Option<String>, data: Option<Vec<u8>>, state: State<DirectoryScopes>) -> Result<Value, String> {
    crate::scoped_directory::directory_io(id, operation, path, to, data, &state)
}
