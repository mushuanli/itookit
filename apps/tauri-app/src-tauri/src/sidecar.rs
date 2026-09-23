//! Page-scoped SQLite pools and connection-bound transactions.
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, Sqlite, SqlitePool, Transaction, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

/// Statements at or above this host-side cost are always recorded.
const SIDECAR_SLOW_SQL_MS: u128 = 25;

#[derive(Default)]
pub struct SidecarTransactions {
    next_id: AtomicU64,
    state: Mutex<SidecarState>,
}

#[derive(Default)]
struct SidecarState {
    scopes: HashMap<String, u64>,
    active: HashMap<u64, ScopedTransaction>,
    databases: HashMap<String, HashMap<(String, u64), usize>>,
    database_locks: HashMap<String, Weak<Mutex<()>>>,
}

struct ScopedTransaction {
    owner: String,
    scope: u64,
    database: String,
    transaction: Arc<Mutex<Option<Transaction<'static, Sqlite>>>>,
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

fn sidecar_sql_trace_enabled() -> bool {
    static TRACE: OnceLock<bool> = OnceLock::new();
    *TRACE.get_or_init(|| {
        std::env::var_os("MINDOS_SIDECAR_TRACE").is_some_and(|value| !value.is_empty())
    })
}

/// Which statements are worth a log line. `idle_before == 0` means the pool had to open a
/// connection (or wait for one), which is what the first statement after sqlx reaped the idle
/// connection looks like; those are the ones that explain a slow cold page.
fn should_record_sql(
    trace: bool,
    wait_ms: u128,
    query_ms: u128,
    idle_before: Option<usize>,
) -> bool {
    trace || wait_ms + query_ms >= SIDECAR_SLOW_SQL_MS || idle_before == Some(0)
}

/// Host-side timing for one sidecar statement. A multi-second client-side measurement cannot be
/// attributed to the host (mutex wait, pool acquire, query) or to request delivery without it.
fn record_sql(
    operation: &str,
    database: &str,
    scope: Option<u64>,
    total_ms: u128,
    wait_ms: u128,
    query_ms: u128,
    rows: usize,
    pool: Option<(u32, usize)>,
) {
    if !should_record_sql(
        sidecar_sql_trace_enabled(),
        wait_ms,
        query_ms,
        pool.map(|(_, idle)| idle),
    ) {
        return;
    }
    let mut detail = serde_json::json!({"operation": operation, "database": database,
        "totalMs": total_ms, "waitMs": wait_ms, "queryMs": query_ms, "rows": rows});
    if let Some(scope) = scope {
        detail["scope"] = serde_json::json!(scope);
    }
    if let Some((size, idle)) = pool {
        detail["poolSize"] = serde_json::json!(size);
        detail["poolIdleBefore"] = serde_json::json!(idle);
    }
    crate::diagnostics::record("sidecar.sql", detail);
}

fn decode_rows(rows: Vec<SqliteRow>) -> Result<Vec<Map<String, Value>>, String> {
    rows.into_iter().map(decode_row).collect()
}

fn decode_row(row: SqliteRow) -> Result<Map<String, Value>, String> {
    let mut result = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            decode_value(&row, index, raw.type_info().name())?
        };
        result.insert(column.name().to_owned(), value);
    }
    Ok(result)
}

fn decode_value(row: &SqliteRow, index: usize, kind: &str) -> Result<Value, String> {
    match kind {
        "TEXT" => row
            .try_get::<String, _>(index)
            .map(Value::from)
            .map_err(|e| e.to_string()),
        "INTEGER" | "NUMERIC" => row
            .try_get::<i64, _>(index)
            .map(Value::from)
            .map_err(|e| e.to_string()),
        "REAL" => row
            .try_get::<f64, _>(index)
            .map(Value::from)
            .map_err(|e| e.to_string()),
        "BOOLEAN" => row
            .try_get::<bool, _>(index)
            .map(Value::from)
            .map_err(|e| e.to_string()),
        _ => Err(format!("Unsupported sidecar column type: {kind}")),
    }
}

impl SidecarTransactions {
    async fn open_scope(&self, owner: &str) -> Result<u64, String> {
        let started = std::time::Instant::now();
        let scope = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut state = self.state.lock().await;
        let previous = state.scopes.insert(owner.to_owned(), scope);
        let ids: Vec<_> = state
            .active
            .iter()
            .filter(|(_, tx)| tx.owner == owner && Some(tx.scope) == previous)
            .map(|(id, _)| *id)
            .collect();
        let pending: Vec<_> = ids
            .iter()
            .filter_map(|id| state.active.remove(id))
            .collect();
        for leases in state.databases.values_mut() {
            leases.retain(|(lease_owner, lease_scope), _| {
                lease_owner != owner || Some(*lease_scope) != previous
            });
        }
        state.databases.retain(|_, leases| !leases.is_empty());
        state
            .database_locks
            .retain(|_, lock| lock.strong_count() > 0);
        drop(state);
        let mut errors = Vec::new();
        for tx in pending {
            if let Some(transaction) = tx.transaction.lock().await.take() {
                if let Err(error) = transaction.rollback().await {
                    errors.push(error.to_string());
                }
            }
        }
        let detail = serde_json::json!({"owner": owner, "scope": scope, "rolledBack": ids.len(),
            "durationMs": started.elapsed().as_millis(), "errors": &errors});
        if errors.is_empty() {
            crate::diagnostics::record("sidecar.scope.open", detail);
        } else {
            crate::diagnostics::record_durable("sidecar.scope.open.failed", detail);
        }
        if errors.is_empty() {
            Ok(scope)
        } else {
            Err(format!(
                "Failed to roll back previous page transactions: {}",
                errors.join("; ")
            ))
        }
    }

    async fn register_database(
        &self,
        owner: &str,
        scope: u64,
        database: &str,
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.scopes.get(owner) != Some(&scope) {
            return Err("Sidecar page scope is no longer active".into());
        }
        *state
            .databases
            .entry(database.to_owned())
            .or_default()
            .entry((owner.to_owned(), scope))
            .or_default() += 1;
        Ok(())
    }

    async fn database_lock(&self, database: &str) -> Arc<Mutex<()>> {
        let mut state = self.state.lock().await;
        if let Some(lock) = state.database_locks.get(database).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        state
            .database_locks
            .insert(database.to_owned(), Arc::downgrade(&lock));
        lock
    }

    async fn assert_database(&self, owner: &str, scope: u64, database: &str) -> Result<(), String> {
        let state = self.state.lock().await;
        let leased = state
            .databases
            .get(database)
            .and_then(|leases| leases.get(&(owner.to_owned(), scope)))
            .is_some_and(|count| *count > 0);
        if leased {
            Ok(())
        } else {
            Err("Sidecar database is not leased by this page".into())
        }
    }

    async fn release_database(&self, owner: &str, scope: u64, database: &str) -> bool {
        let mut state = self.state.lock().await;
        let Some(leases) = state.databases.get_mut(database) else {
            return false;
        };
        let key = (owner.to_owned(), scope);
        let Some(count) = leases.get_mut(&key) else {
            return false;
        };
        if *count > 1 {
            *count -= 1;
        } else {
            leases.remove(&key);
        }
        if !leases.is_empty() {
            return false;
        }
        state.databases.remove(database);
        true
    }

    async fn is_last_owner_lease(&self, owner: &str, scope: u64, database: &str) -> bool {
        self.state
            .lock()
            .await
            .databases
            .get(database)
            .and_then(|leases| leases.get(&(owner.to_owned(), scope)))
            == Some(&1)
    }

    async fn rollback_database(
        &self,
        owner: &str,
        scope: u64,
        database: &str,
    ) -> Result<(), String> {
        let pending = {
            let mut state = self.state.lock().await;
            let ids: Vec<_> = state
                .active
                .iter()
                .filter(|(_, tx)| tx.owner == owner && tx.scope == scope && tx.database == database)
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter()
                .filter_map(|id| state.active.remove(&id))
                .collect::<Vec<_>>()
        };
        let mut errors = Vec::new();
        for tx in pending {
            if let Some(transaction) = tx.transaction.lock().await.take() {
                if let Err(error) = transaction.rollback().await {
                    errors.push(error.to_string());
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    async fn begin(
        &self,
        pool: &SqlitePool,
        owner: &str,
        scope: u64,
        database: &str,
    ) -> Result<u64, String> {
        if self.state.lock().await.scopes.get(owner) != Some(&scope) {
            return Err("Sidecar page scope is no longer active".into());
        }
        let (pool_size, pool_idle) = (pool.size(), pool.num_idle());
        let wait_start = Instant::now();
        // Do not hold active's mutex while waiting for another SQLite writer.
        let tx = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let wait_ms = wait_start.elapsed().as_millis();
        record_sql(
            "begin",
            database,
            Some(scope),
            wait_ms,
            wait_ms,
            0,
            0,
            Some((pool_size, pool_idle)),
        );
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut state = self.state.lock().await;
        let leased = state
            .databases
            .get(database)
            .and_then(|leases| leases.get(&(owner.to_owned(), scope)))
            .is_some_and(|count| *count > 0);
        if state.scopes.get(owner) != Some(&scope) || !leased {
            drop(state);
            tx.rollback().await.map_err(|error| error.to_string())?;
            return Err("Sidecar page scope changed while waiting for a transaction".into());
        }
        state.active.insert(
            id,
            ScopedTransaction {
                owner: owner.to_owned(),
                scope,
                database: database.to_owned(),
                transaction: Arc::new(Mutex::new(Some(tx))),
            },
        );
        Ok(id)
    }

    async fn transaction_for(
        &self,
        id: u64,
        owner: &str,
        scope: u64,
        database: &str,
    ) -> Result<Arc<Mutex<Option<Transaction<'static, Sqlite>>>>, String> {
        let state = self.state.lock().await;
        let entry = state
            .active
            .get(&id)
            .ok_or("Sidecar transaction is no longer active")?;
        if entry.owner != owner
            || entry.scope != scope
            || entry.database != database
            || state.scopes.get(owner) != Some(&scope)
        {
            return Err("Sidecar transaction does not belong to this page".into());
        }
        Ok(entry.transaction.clone())
    }

    async fn execute(
        &self,
        id: u64,
        owner: &str,
        scope: u64,
        database: &str,
        query: &str,
        values: Vec<Value>,
    ) -> Result<ExecuteResult, String> {
        let started = Instant::now();
        let tx = self.transaction_for(id, owner, scope, database).await?;
        let lock_start = Instant::now();
        let mut transaction = tx.lock().await;
        let wait_ms = lock_start.elapsed().as_millis();
        let transaction = transaction
            .as_mut()
            .ok_or("Sidecar transaction is no longer active")?;
        let query_start = Instant::now();
        let result = bind_query(query, values)?
            .execute(&mut **transaction)
            .await
            .map_err(|e| e.to_string())?;
        record_sql(
            "execute",
            database,
            Some(scope),
            started.elapsed().as_millis(),
            wait_ms,
            query_start.elapsed().as_millis(),
            result.rows_affected() as usize,
            None,
        );
        Ok(ExecuteResult {
            rows_affected: result.rows_affected(),
            last_insert_id: result.last_insert_rowid(),
        })
    }

    async fn select(
        &self,
        id: u64,
        owner: &str,
        scope: u64,
        database: &str,
        query: &str,
        values: Vec<Value>,
    ) -> Result<Vec<Map<String, Value>>, String> {
        let started = Instant::now();
        let tx = self.transaction_for(id, owner, scope, database).await?;
        let lock_start = Instant::now();
        let mut transaction = tx.lock().await;
        let wait_ms = lock_start.elapsed().as_millis();
        let transaction = transaction
            .as_mut()
            .ok_or("Sidecar transaction is no longer active")?;
        let query_start = Instant::now();
        let rows = bind_query(query, values)?
            .fetch_all(&mut **transaction)
            .await
            .map_err(|e| e.to_string())?;
        record_sql(
            "select",
            database,
            Some(scope),
            started.elapsed().as_millis(),
            wait_ms,
            query_start.elapsed().as_millis(),
            rows.len(),
            None,
        );
        decode_rows(rows)
    }

    async fn finish(
        &self,
        id: u64,
        owner: &str,
        scope: u64,
        database: &str,
        commit: bool,
    ) -> Result<(), String> {
        let started = Instant::now();
        let tx = self.transaction_for(id, owner, scope, database).await?;
        let lock_start = Instant::now();
        let mut guard = tx.lock().await;
        let wait_ms = lock_start.elapsed().as_millis();
        let transaction = guard.take();
        let query_start = Instant::now();
        let result = match transaction {
            Some(tx) if commit => tx.commit().await.map_err(|e| e.to_string()),
            Some(tx) => tx.rollback().await.map_err(|e| e.to_string()),
            // A failed commit consumes the handle; SQLx rolls back on drop.
            None if !commit => Ok(()),
            None => Err("Sidecar transaction is no longer active".into()),
        };
        record_sql(
            if commit { "commit" } else { "rollback" },
            database,
            Some(scope),
            started.elapsed().as_millis(),
            wait_ms,
            query_start.elapsed().as_millis(),
            0,
            None,
        );
        if result.is_ok() || !commit {
            self.state.lock().await.active.remove(&id);
        }
        result
    }
}

async fn database_pool(databases: &DbInstances, database: &str) -> Result<SqlitePool, String> {
    let instances = databases.0.read().await;
    match instances.get(database) {
        Some(DbPool::Sqlite(pool)) if !pool.is_closed() => Ok(pool.clone()),
        Some(_) => Err("SQLite sidecar database is closed".into()),
        None => Err("SQLite sidecar database is not loaded".into()),
    }
}

async fn connect_database(database: &str) -> Result<SqlitePool, String> {
    if !database.starts_with("sqlite:") {
        return Err("Sidecar database must use SQLite".into());
    }
    let options = SqliteConnectOptions::from_str(database)
        .map_err(|error| error.to_string())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(30))
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

async fn retire_pool(pool: SqlitePool, database: String) {
    if tokio::time::timeout(Duration::from_secs(2), pool.close())
        .await
        .is_err()
    {
        crate::diagnostics::record_durable(
            "sidecar.database.close.timeout",
            serde_json::json!({"database": database}),
        );
    }
}

/// Returns true when an existing SQLite pool was reused.
#[tauri::command]
pub async fn sidecar_open_database(
    database: String,
    scope: u64,
    webview: tauri::WebviewWindow,
    paths: State<'_, crate::AppPaths>,
    databases: State<'_, DbInstances>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<bool, String> {
    let started = std::time::Instant::now();
    let path = database
        .strip_prefix("sqlite:")
        .ok_or("Sidecar database must use SQLite")?;
    if !crate::is_allowed(std::path::Path::new(path), &paths) {
        return Err("Sidecar database path is not allowed".into());
    }
    let result =
        open_database_for_page(&database, webview.label(), scope, &databases, &transactions).await;
    record_database_open(&database, scope, started.elapsed().as_millis(), &result);
    result
}

async fn open_database_for_page(
    database: &str,
    owner: &str,
    scope: u64,
    databases: &DbInstances,
    transactions: &SidecarTransactions,
) -> Result<bool, String> {
    let lock = transactions.database_lock(&database).await;
    let guard = lock.lock().await;
    transactions
        .register_database(owner, scope, &database)
        .await?;
    let existing = database_pool(&databases, &database).await.ok();
    let opened = if existing.is_some() {
        Ok((true, None))
    } else {
        open_new_database(&database, owner, scope, &databases, &transactions)
            .await
            .map(|replaced| (false, replaced))
    };
    let (reused, replaced) = match opened {
        Ok(value) => value,
        Err(error) => {
            transactions.release_database(owner, scope, &database).await;
            return Err(error);
        }
    };
    let valid = transactions.assert_database(owner, scope, &database).await;
    if valid.is_err() {
        transactions.release_database(owner, scope, &database).await;
    }
    drop(guard);
    if let Some(pool) = replaced {
        let database = database.to_owned();
        tauri::async_runtime::spawn(async move { retire_pool(pool, database).await });
    }
    valid?;
    Ok(reused)
}

fn record_database_open(
    database: &str,
    scope: u64,
    duration_ms: u128,
    result: &Result<bool, String>,
) {
    let detail = serde_json::json!({"database": database, "scope": scope,
        "reused": result.as_ref().ok(), "durationMs": duration_ms, "error": result.as_ref().err()});
    if result.is_ok() {
        crate::diagnostics::record("sidecar.database.open", detail);
    } else {
        crate::diagnostics::record_durable("sidecar.database.open.failed", detail);
    }
}

async fn open_new_database(
    database: &str,
    owner: &str,
    scope: u64,
    databases: &DbInstances,
    transactions: &SidecarTransactions,
) -> Result<Option<SqlitePool>, String> {
    let candidate = connect_database(database).await?;
    if let Err(error) = transactions.assert_database(owner, scope, database).await {
        candidate.close().await;
        return Err(error);
    }
    let replaced = databases
        .0
        .write()
        .await
        .insert(database.to_owned(), DbPool::Sqlite(candidate));
    Ok(match replaced {
        Some(DbPool::Sqlite(pool)) => Some(pool),
        _ => None,
    })
}

#[tauri::command]
pub async fn sidecar_database_execute(
    database: String,
    scope: u64,
    query: String,
    values: Vec<Value>,
    webview: tauri::WebviewWindow,
    databases: State<'_, DbInstances>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<ExecuteResult, String> {
    transactions
        .assert_database(webview.label(), scope, &database)
        .await?;
    let pool = database_pool(&databases, &database).await?;
    let (pool_size, pool_idle) = (pool.size(), pool.num_idle());
    let started = Instant::now();
    let acquire_start = Instant::now();
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let wait_ms = acquire_start.elapsed().as_millis();
    let query_start = Instant::now();
    let result = bind_query(&query, values)?
        .execute(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    record_sql(
        "database_execute",
        &database,
        Some(scope),
        started.elapsed().as_millis(),
        wait_ms,
        query_start.elapsed().as_millis(),
        result.rows_affected() as usize,
        Some((pool_size, pool_idle)),
    );
    Ok(ExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

#[tauri::command]
pub async fn sidecar_database_select(
    database: String,
    scope: u64,
    query: String,
    values: Vec<Value>,
    webview: tauri::WebviewWindow,
    databases: State<'_, DbInstances>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<Vec<Map<String, Value>>, String> {
    transactions
        .assert_database(webview.label(), scope, &database)
        .await?;
    let pool = database_pool(&databases, &database).await?;
    let (pool_size, pool_idle) = (pool.size(), pool.num_idle());
    let started = Instant::now();
    let acquire_start = Instant::now();
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let wait_ms = acquire_start.elapsed().as_millis();
    let query_start = Instant::now();
    let rows = bind_query(&query, values)?
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    record_sql(
        "database_select",
        &database,
        Some(scope),
        started.elapsed().as_millis(),
        wait_ms,
        query_start.elapsed().as_millis(),
        rows.len(),
        Some((pool_size, pool_idle)),
    );
    decode_rows(rows)
}

#[tauri::command]
pub async fn sidecar_close_database(
    database: String,
    scope: u64,
    webview: tauri::WebviewWindow,
    databases: State<'_, DbInstances>,
    transactions: State<'_, SidecarTransactions>,
) -> Result<bool, String> {
    let lock = transactions.database_lock(&database).await;
    let guard = lock.lock().await;
    let owner_done = transactions
        .is_last_owner_lease(webview.label(), scope, &database)
        .await;
    let final_lease = transactions
        .release_database(webview.label(), scope, &database)
        .await;
    let rollback = if owner_done {
        transactions
            .rollback_database(webview.label(), scope, &database)
            .await
    } else {
        Ok(())
    };
    let removed = if final_lease {
        databases.0.write().await.remove(&database)
    } else {
        None
    };
    drop(guard);
    if let Some(DbPool::Sqlite(pool)) = removed {
        retire_pool(pool, database).await;
    }
    rollback?;
    Ok(final_lease)
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
    transactions
        .assert_database(webview.label(), scope, &database)
        .await?;
    let pool = {
        let databases = databases.0.read().await;
        match databases.get(&database) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("SQLite sidecar database is not loaded".into()),
        }
    };
    transactions
        .begin(&pool, webview.label(), scope, &database)
        .await
}

#[tauri::command]
pub async fn sidecar_execute(
    transaction_id: u64,
    database: String,
    scope: u64,
    query: String,
    values: Vec<Value>,
    webview: tauri::WebviewWindow,
    transactions: State<'_, SidecarTransactions>,
) -> Result<ExecuteResult, String> {
    transactions
        .execute(
            transaction_id,
            webview.label(),
            scope,
            &database,
            &query,
            values,
        )
        .await
}

#[tauri::command]
pub async fn sidecar_select(
    transaction_id: u64,
    database: String,
    scope: u64,
    query: String,
    values: Vec<Value>,
    webview: tauri::WebviewWindow,
    transactions: State<'_, SidecarTransactions>,
) -> Result<Vec<Map<String, Value>>, String> {
    transactions
        .select(
            transaction_id,
            webview.label(),
            scope,
            &database,
            &query,
            values,
        )
        .await
}

#[tauri::command]
pub async fn sidecar_finish(
    transaction_id: u64,
    database: String,
    scope: u64,
    commit: bool,
    webview: tauri::WebviewWindow,
    transactions: State<'_, SidecarTransactions>,
) -> Result<(), String> {
    transactions
        .finish(transaction_id, webview.label(), scope, &database, commit)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

    #[test]
    fn records_slow_statements_and_connection_rebuilds_only() {
        // Warm and fast: quiet, so a busy session does not pay a log write per statement.
        assert!(!should_record_sql(false, 0, 1, Some(3)));
        // The pool had to open a connection: always worth a line (cold page, reaped idle pool).
        assert!(should_record_sql(false, 0, 1, Some(0)));
        // Host-side wait or query above the threshold is always worth a line.
        assert!(should_record_sql(false, SIDECAR_SLOW_SQL_MS, 0, Some(2)));
        assert!(should_record_sql(false, 0, SIDECAR_SLOW_SQL_MS, None));
        // MINDOS_SIDECAR_TRACE=1 records everything, including transaction-scoped statements.
        assert!(should_record_sql(true, 0, 0, None));
    }

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
            transactions
                .register_database("main", scope, "sqlite:/test")
                .await
                .unwrap();
            let id = transactions
                .begin(&pool, "main", scope, "sqlite:/test")
                .await
                .unwrap();
            transactions
                .execute(
                    id,
                    "main",
                    scope,
                    "sqlite:/test",
                    "INSERT INTO records VALUES (?, ?)",
                    vec![Value::from("one"), Value::from("ready")],
                )
                .await
                .unwrap();
            assert_eq!(
                transactions
                    .select(
                        id,
                        "main",
                        scope,
                        "sqlite:/test",
                        "SELECT value FROM records",
                        vec![]
                    )
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
                    transactions
                        .begin(&pool, "main", scope, "sqlite:/test")
                        .await
                })
            };
            transactions
                .finish(id, "main", scope, "sqlite:/test", true)
                .await
                .unwrap();
            let next = pending.await.unwrap().unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
            transactions
                .execute(
                    next,
                    "main",
                    scope,
                    "sqlite:/test",
                    "UPDATE records SET value = 'discard'",
                    vec![],
                )
                .await
                .unwrap();
            assert!(transactions
                .execute(
                    next,
                    "main",
                    scope,
                    "sqlite:/test",
                    "INSERT INTO records VALUES ('one', 'duplicate')",
                    vec![]
                )
                .await
                .is_err());
            transactions
                .finish(next, "main", scope, "sqlite:/test", false)
                .await
                .unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT value FROM records")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                "ready"
            );
            assert!(transactions
                .select(next, "main", scope, "sqlite:/test", "SELECT 1", vec![])
                .await
                .is_err());

            // Deferred FK failure exercises failed COMMIT and rollback-on-drop.
            sqlx::query("CREATE TABLE child (parent TEXT REFERENCES records(path) DEFERRABLE INITIALLY DEFERRED)").execute(&pool).await.unwrap();
            let failed = transactions
                .begin(&pool, "main", scope, "sqlite:/test")
                .await
                .unwrap();
            transactions
                .execute(
                    failed,
                    "main",
                    scope,
                    "sqlite:/test",
                    "INSERT INTO child VALUES ('missing')",
                    vec![],
                )
                .await
                .unwrap();
            assert!(transactions
                .finish(failed, "main", scope, "sqlite:/test", true)
                .await
                .is_err());
            transactions
                .finish(failed, "main", scope, "sqlite:/test", false)
                .await
                .unwrap();
            let last = transactions
                .begin(&pool, "main", scope, "sqlite:/test")
                .await
                .unwrap();
            transactions
                .finish(last, "main", scope, "sqlite:/test", true)
                .await
                .unwrap();
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
            transactions
                .register_database("main", old_scope, "sqlite:/test")
                .await
                .unwrap();
            let old = transactions
                .begin(&pool, "main", old_scope, "sqlite:/test")
                .await
                .unwrap();
            transactions
                .execute(
                    old,
                    "main",
                    old_scope,
                    "sqlite:/test",
                    "INSERT INTO records VALUES ('orphan')",
                    vec![],
                )
                .await
                .unwrap();
            let waiting = {
                let transactions = transactions.clone();
                let pool = pool.clone();
                tauri::async_runtime::spawn(async move {
                    transactions
                        .begin(&pool, "main", old_scope, "sqlite:/test")
                        .await
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
            assert!(transactions
                .finish(old, "main", old_scope, "sqlite:/test", true)
                .await
                .is_err());
            assert!(transactions
                .begin(&pool, "main", old_scope, "sqlite:/test")
                .await
                .is_err());
            transactions
                .register_database("main", current, "sqlite:/test")
                .await
                .unwrap();
            let fresh = transactions
                .begin(&pool, "main", current, "sqlite:/test")
                .await
                .unwrap();
            assert_eq!(
                transactions
                    .select(
                        fresh,
                        "main",
                        current,
                        "sqlite:/test",
                        "SELECT COUNT(*) AS count FROM records",
                        vec![]
                    )
                    .await
                    .unwrap()[0]["count"],
                0
            );
            // Another window opening a page cannot revoke this page's transaction.
            transactions.open_scope("other-window").await.unwrap();
            transactions
                .execute(
                    fresh,
                    "main",
                    current,
                    "sqlite:/test",
                    "INSERT INTO records VALUES ('kept')",
                    vec![],
                )
                .await
                .unwrap();
            transactions
                .finish(fresh, "main", current, "sqlite:/test", true)
                .await
                .unwrap();
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

    #[test]
    fn page_reload_transfers_database_ownership_and_fences_stale_close() {
        tauri::async_runtime::block_on(async {
            let transactions = SidecarTransactions::default();
            let old = transactions.open_scope("main").await.unwrap();
            transactions
                .register_database("main", old, "sqlite:/one")
                .await
                .unwrap();
            let current = transactions.open_scope("main").await.unwrap();
            transactions
                .register_database("main", current, "sqlite:/one")
                .await
                .unwrap();
            assert!(
                !transactions
                    .release_database("main", old, "sqlite:/one")
                    .await
            );
            transactions
                .assert_database("main", current, "sqlite:/one")
                .await
                .unwrap();
            assert!(
                transactions
                    .release_database("main", current, "sqlite:/one")
                    .await
            );
            assert!(transactions
                .assert_database("main", current, "sqlite:/one")
                .await
                .is_err());
        });
    }

    #[test]
    fn transaction_id_cannot_cross_windows_or_databases() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            let transactions = SidecarTransactions::default();
            let first = transactions.open_scope("first").await.unwrap();
            let second = transactions.open_scope("second").await.unwrap();
            transactions
                .register_database("first", first, "sqlite:/one")
                .await
                .unwrap();
            transactions
                .register_database("second", second, "sqlite:/one")
                .await
                .unwrap();
            let id = transactions
                .begin(&pool, "first", first, "sqlite:/one")
                .await
                .unwrap();
            assert!(transactions
                .select(id, "second", second, "sqlite:/one", "SELECT 1", vec![])
                .await
                .is_err());
            assert!(transactions
                .execute(id, "second", second, "sqlite:/one", "SELECT 1", vec![])
                .await
                .is_err());
            assert!(transactions
                .finish(id, "second", second, "sqlite:/one", false)
                .await
                .is_err());
            assert!(transactions
                .finish(id, "first", first, "sqlite:/other", false)
                .await
                .is_err());
            assert_eq!(
                transactions
                    .select(
                        id,
                        "first",
                        first,
                        "sqlite:/one",
                        "SELECT 1 AS value",
                        vec![]
                    )
                    .await
                    .unwrap()[0]["value"],
                1
            );
            transactions
                .finish(id, "first", first, "sqlite:/one", false)
                .await
                .unwrap();
            pool.close().await;
        });
    }

    #[test]
    fn closing_a_database_rolls_back_an_abandoned_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            let transactions = SidecarTransactions::default();
            let scope = transactions.open_scope("main").await.unwrap();
            transactions
                .register_database("main", scope, "sqlite:/one")
                .await
                .unwrap();
            let id = transactions
                .begin(&pool, "main", scope, "sqlite:/one")
                .await
                .unwrap();
            assert!(
                transactions
                    .is_last_owner_lease("main", scope, "sqlite:/one")
                    .await
            );
            assert!(
                transactions
                    .release_database("main", scope, "sqlite:/one")
                    .await
            );
            transactions
                .rollback_database("main", scope, "sqlite:/one")
                .await
                .unwrap();
            assert!(transactions
                .finish(id, "main", scope, "sqlite:/one", true)
                .await
                .is_err());
            tokio::time::timeout(Duration::from_millis(100), pool.close())
                .await
                .unwrap();
        });
    }

    #[test]
    fn replacing_a_borrowed_pool_does_not_hold_the_database_open_lock() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "sidecar-replace-{}-{}.sqlite",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let database = format!("sqlite:{}", path.display());
            let old = connect_database(&database).await.unwrap();
            let borrowed = old.acquire().await.unwrap();
            let instances = DbInstances::default();
            instances
                .0
                .write()
                .await
                .insert(database.clone(), DbPool::Sqlite(old));
            let transactions = SidecarTransactions::default();
            let scope = transactions.open_scope("main").await.unwrap();
            transactions
                .register_database("main", scope, &database)
                .await
                .unwrap();
            let lock = transactions.database_lock(&database).await;
            let guard = lock.lock().await;
            let replaced = tokio::time::timeout(
                Duration::from_secs(1),
                open_new_database(&database, "main", scope, &instances, &transactions),
            )
            .await
            .unwrap()
            .unwrap()
            .unwrap();
            drop(guard);
            let _next_open = tokio::time::timeout(Duration::from_millis(100), lock.lock())
                .await
                .unwrap();
            tokio::time::timeout(
                Duration::from_secs(3),
                retire_pool(replaced, database.clone()),
            )
            .await
            .unwrap();
            drop(borrowed);
            let current = database_pool(&instances, &database).await.unwrap();
            current.close().await;
            instances.0.write().await.remove(&database);
            std::fs::remove_file(path).unwrap();
        });
    }

    #[test]
    fn concurrent_opens_of_one_database_share_a_pool() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!(
                "sidecar-singleflight-{}-{}.sqlite",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let database = format!("sqlite:{}", path.display());
            let instances = Arc::new(DbInstances::default());
            let transactions = Arc::new(SidecarTransactions::default());
            let scope = transactions.open_scope("main").await.unwrap();
            let mut tasks = Vec::new();
            for _ in 0..2 {
                let db = database.clone();
                let instances = instances.clone();
                let transactions = transactions.clone();
                tasks.push(tauri::async_runtime::spawn(async move {
                    open_database_for_page(&db, "main", scope, &instances, &transactions).await
                }));
            }
            let mut reused = Vec::new();
            for task in tasks {
                reused.push(task.await.unwrap().unwrap());
            }
            reused.sort();
            assert_eq!(reused, [false, true]);
            assert_eq!(instances.0.read().await.len(), 1);
            assert!(
                !transactions
                    .release_database("main", scope, &database)
                    .await
            );
            assert!(
                transactions
                    .release_database("main", scope, &database)
                    .await
            );
            let pool = database_pool(&instances, &database).await.unwrap();
            pool.close().await;
            instances.0.write().await.remove(&database);
            std::fs::remove_file(path).unwrap();
        });
    }
}
