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
    active: Mutex<HashMap<u64, Transaction<'static, Sqlite>>>,
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
    async fn begin(&self, pool: &SqlitePool) -> Result<u64, String> {
        // Do not hold active's mutex while waiting for another SQLite writer.
        let tx = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.active.lock().await.insert(id, tx);
        Ok(id)
    }

    async fn execute(
        &self,
        id: u64,
        query: &str,
        values: Vec<Value>,
    ) -> Result<ExecuteResult, String> {
        let mut active = self.active.lock().await;
        let tx = active
            .get_mut(&id)
            .ok_or("Sidecar transaction is no longer active")?;
        let result = bind_query(query, values)?
            .execute(&mut **tx)
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
        let mut active = self.active.lock().await;
        let tx = active
            .get_mut(&id)
            .ok_or("Sidecar transaction is no longer active")?;
        let rows = bind_query(query, values)?
            .fetch_all(&mut **tx)
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
        let tx = self.active.lock().await.remove(&id);
        match tx {
            Some(tx) if commit => tx.commit().await.map_err(|e| e.to_string()),
            Some(tx) => tx.rollback().await.map_err(|e| e.to_string()),
            // A failed commit consumes the handle; SQLx rolls back on drop.
            None if !commit => Ok(()),
            None => Err("Sidecar transaction is no longer active".into()),
        }
    }
}

#[tauri::command]
pub async fn sidecar_begin(
    database: String,
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
    transactions.begin(&pool).await
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
            let id = transactions.begin(&pool).await.unwrap();
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
                tauri::async_runtime::spawn(async move { transactions.begin(&pool).await })
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
            let failed = transactions.begin(&pool).await.unwrap();
            transactions
                .execute(failed, "INSERT INTO child VALUES ('missing')", vec![])
                .await
                .unwrap();
            assert!(transactions.finish(failed, true).await.is_err());
            transactions.finish(failed, false).await.unwrap();
            let last = transactions.begin(&pool).await.unwrap();
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
}
