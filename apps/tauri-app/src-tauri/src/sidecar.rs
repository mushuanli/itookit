//! Connection-bound transactions over the databases already opened by plugin-sql.
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{Column, Row, Sqlite, SqlitePool, Transaction, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SidecarTransactions {
    next_id: AtomicU64,
    state: Mutex<SidecarState>,
}

#[derive(Default)]
struct SidecarState {
    scopes: HashMap<String, u64>,
    active: HashMap<u64, ScopedTransaction>,
}

struct ScopedTransaction {
    scope: u64,
    transaction: Transaction<'static, Sqlite>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    rows_affected: u64,
    last_insert_id: i64,
}

fn bind_query(
    query: &str,
    values: Vec<Value>,
) -> Result<sqlx::query::Query<'_, Sqlite, sqlx::sqlite::SqliteArguments<'_>>, String> {
    let mut statement = sqlx::query(query);
    for value in values {
        statement = match value {
            Value::Null => statement.bind(None::<String>),
            Value::String(value) => statement.bind(value),
            Value::Bool(value) => statement.bind(value),
            Value::Number(value) => {
                if let Some(value) = value.as_i64() {
                    statement.bind(value)
                } else if let Some(value) = value.as_f64() {
                    statement.bind(value)
                } else {
                    return Err("Unsupported SQLite number".into());
                }
            }
            _ => return Err("Sidecar SQL parameters must be scalar values".into()),
        };
    }
    Ok(statement)
}

impl SidecarTransactions {
    async fn open_scope(&self, owner: &str) -> Result<u64, String> {
        let scope = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut state = self.state.lock().await;
        let previous = state.scopes.insert(owner.to_owned(), scope);
        let ids: Vec<_> = state
            .active
            .iter()
            .filter(|(_, tx)| Some(tx.scope) == previous)
            .map(|(id, _)| *id)
            .collect();
        let pending: Vec<_> = ids
            .iter()
            .filter_map(|id| state.active.remove(id))
            .collect();
        drop(state);
        let mut errors = Vec::new();
        for tx in pending {
            if let Err(error) = tx.transaction.rollback().await {
                errors.push(error.to_string());
            }
        }
        crate::diagnostics::record(
            "sidecar.scope.open",
            serde_json::json!({"owner": owner, "scope": scope, "rolledBack": ids.len(), "errors": errors}),
        );
        if errors.is_empty() {
            Ok(scope)
        } else {
            Err(format!(
                "Failed to roll back previous page transactions: {}",
                errors.join("; ")
            ))
        }
    }

    async fn begin(&self, pool: &SqlitePool, owner: &str, scope: u64) -> Result<u64, String> {
        if self.state.lock().await.scopes.get(owner) != Some(&scope) {
            return Err("Sidecar page scope is no longer active".into());
        }
        // Do not hold active's mutex while waiting for another SQLite writer.
        let tx = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut state = self.state.lock().await;
        if state.scopes.get(owner) != Some(&scope) {
            drop(state);
            tx.rollback().await.map_err(|error| error.to_string())?;
            return Err("Sidecar page scope changed while waiting for a transaction".into());
        }
        state.active.insert(
            id,
            ScopedTransaction {
                scope,
                transaction: tx,
            },
        );
        Ok(id)
    }

    async fn execute(
        &self,
        id: u64,
        query: &str,
        values: Vec<Value>,
    ) -> Result<ExecuteResult, String> {
        let mut state = self.state.lock().await;
        let tx = state
            .active
            .get_mut(&id)
            .ok_or("Sidecar transaction is no longer active")?;
        let result = bind_query(query, values)?
            .execute(&mut *tx.transaction)
            .await
            .map_err(|e| e.to_string())?;
        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: result.last_insert_rowid(),
        })
    }

    async fn select(
        &self,
        id: u64,
        query: &str,
        values: Vec<Value>,
    ) -> Result<Vec<Map<String, Value>>, String> {
        let mut state = self.state.lock().await;
        let tx = state
            .active
            .get_mut(&id)
            .ok_or("Sidecar transaction is no longer active")?;
        let rows = bind_query(query, values)?
            .fetch_all(&mut *tx.transaction)
            .await
            .map_err(|e| e.to_string())?;
        rows.into_iter()
            .map(|row| {
                let mut result = Map::new();
                for (index, column) in row.columns().iter().enumerate() {
                    let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
                    let value = if raw.is_null() {
                        Value::Null
                    } else {
                        match raw.type_info().name() {
                            "TEXT" => Value::from(
                                row.try_get::<String, _>(index).map_err(|e| e.to_string())?,
                            ),
                            "INTEGER" | "NUMERIC" => Value::from(
                                row.try_get::<i64, _>(index).map_err(|e| e.to_string())?,
                            ),
                            "REAL" => Value::from(
                                row.try_get::<f64, _>(index).map_err(|e| e.to_string())?,
                            ),
                            "BOOLEAN" => Value::from(
                                row.try_get::<bool, _>(index).map_err(|e| e.to_string())?,
                            ),
                            kind => return Err(format!("Unsupported sidecar column type: {kind}")),
                        }
                    };
                    result.insert(column.name().to_owned(), value);
                }
                Ok(result)
            })
            .collect()
    }

    async fn finish(&self, id: u64, commit: bool) -> Result<(), String> {
        let tx = self.state.lock().await.active.remove(&id);
        match tx {
            Some(tx) if commit => tx.transaction.commit().await.map_err(|e| e.to_string()),
            Some(tx) => tx.transaction.rollback().await.map_err(|e| e.to_string()),
            // A failed commit consumes the handle; SQLx rolls back on drop.
            None if !commit => Ok(()),
            None => Err("Sidecar transaction is no longer active".into()),
        }
    }
}

#[tauri::command]
pub async fn sidecar_open_scope(
    webview: tauri::WebviewWindow,
    transactions: State<'_, SidecarTransactions>,
) -> Result<u64, String> {
    transactions.open_scope(webview.label()).await
}

#[tauri::command]
pub async fn sidecar_begin(
    database: String,
    scope: u64,
    webview: tauri::WebviewWindow,
    databases: State<'_, DbInstances>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<u64, String> {
    let pool = {
        let databases = databases.0.read().await;
        match databases.get(&database) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("SQLite sidecar database is not loaded".into()),
        }
    };
    transactions.begin(&pool, webview.label(), scope).await
}

#[tauri::command]
pub async fn sidecar_execute(
    transaction_id: u64,
    query: String,
    values: Vec<Value>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<ExecuteResult, String> {
    transactions.execute(transaction_id, &query, values).await
}

#[tauri::command]
pub async fn sidecar_select(
    transaction_id: u64,
    query: String,
    values: Vec<Value>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<Vec<Map<String, Value>>, String> {
    transactions.select(transaction_id, &query, values).await
}

#[tauri::command]
pub async fn sidecar_finish(
    transaction_id: u64,
    commit: bool,
    transactions: State<'_, SidecarTransactions>,
) -> Result<(), String> {
    transactions.finish(transaction_id, commit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

    #[test]
    fn transactions_keep_connection_and_recover_after_failures() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "sidecar-tx-{}-{}.sqlite",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let pool = SqlitePoolOptions::new()
                .max_connections(3)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true)
                        .journal_mode(SqliteJournalMode::Wal)
                        .foreign_keys(true),
                )
                .await
                .unwrap();
            sqlx::query("CREATE TABLE records (path TEXT PRIMARY KEY, value TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            let transactions = std::sync::Arc::new(SidecarTransactions::default());
            let scope = transactions.open_scope("main").await.unwrap();
            let id = transactions.begin(&pool, "main", scope).await.unwrap();
            transactions
                .execute(
                    id,
                    "INSERT INTO records VALUES (?, ?)",
                    vec![Value::from("one"), Value::from("ready")],
                )
                .await
                .unwrap();
            assert_eq!(
                transactions
                    .select(id, "SELECT value FROM records", vec![])
                    .await
                    .unwrap()[0]["value"],
                "ready"
            );
            // An unrelated pooled read must not see the uncommitted write.
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0
            );
            // A second writer waits without preventing the first from committing.
            let pending = {
                let transactions = transactions.clone();
                let pool = pool.clone();
                tauri::async_runtime::spawn(async move {
                    transactions.begin(&pool, "main", scope).await
                })
            };
            transactions.finish(id, true).await.unwrap();
            let next = pending.await.unwrap().unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
            transactions
                .execute(next, "UPDATE records SET value = 'discard'", vec![])
                .await
                .unwrap();
            assert!(transactions
                .execute(
                    next,
                    "INSERT INTO records VALUES ('one', 'duplicate')",
                    vec![]
                )
                .await
                .is_err());
            transactions.finish(next, false).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT value FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                "ready"
            );
            assert!(transactions.select(next, "SELECT 1", vec![]).await.is_err());

            // Deferred FK failure exercises failed COMMIT and rollback-on-drop.
            sqlx::query("CREATE TABLE child (parent TEXT REFERENCES records(path) DEFERRABLE INITIALLY DEFERRED)").execute(&pool).await.unwrap();
            let failed = transactions.begin(&pool, "main", scope).await.unwrap();
            transactions
                .execute(failed, "INSERT INTO child VALUES ('missing')", vec![])
                .await
                .unwrap();
            assert!(transactions.finish(failed, true).await.is_err());
            transactions.finish(failed, false).await.unwrap();
            let last = transactions.begin(&pool, "main", scope).await.unwrap();
            transactions.finish(last, true).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM child")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0
            );
            pool.close().await;
            std::fs::remove_file(path).unwrap();
        });
    }
    #[test]
    fn page_reload_rolls_back_orphans_and_fences_waiting_transactions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query("CREATE TABLE records (value TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            let transactions = std::sync::Arc::new(SidecarTransactions::default());
            let old_scope = transactions.open_scope("main").await.unwrap();
            let old = transactions.begin(&pool, "main", old_scope).await.unwrap();
            transactions
                .execute(old, "INSERT INTO records VALUES ('orphan')", vec![])
                .await
                .unwrap();
            let waiting = {
                let transactions = transactions.clone();
                let pool = pool.clone();
                tauri::async_runtime::spawn(async move {
                    transactions.begin(&pool, "main", old_scope).await
                })
            };
            // The single connection is still owned by the abandoned page.
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(20), pool.acquire())
                    .await
                    .is_err()
            );
            let current = transactions.open_scope("main").await.unwrap();
            assert!(waiting.await.unwrap().is_err());
            assert!(transactions.finish(old, true).await.is_err());
            assert!(transactions.begin(&pool, "main", old_scope).await.is_err());
            let fresh = transactions.begin(&pool, "main", current).await.unwrap();
            assert_eq!(
                transactions
                    .select(fresh, "SELECT COUNT(*) AS count FROM records", vec![])
                    .await
                    .unwrap()[0]["count"],
                0
            );
            // Another window opening a page cannot revoke this page's transaction.
            transactions.open_scope("other-window").await.unwrap();
            transactions
                .execute(fresh, "INSERT INTO records VALUES ('kept')", vec![])
                .await
                .unwrap();
            transactions.finish(fresh, true).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT value FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                "kept"
            );
            pool.close().await;
        });
    }
}
