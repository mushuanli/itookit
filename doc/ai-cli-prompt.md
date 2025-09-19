# 下面是一个基于Rust的AI聊天软件，支持客户端/服务器架构的软件要求。
```

用 rust 设计一个使用 text的ai聊天软件， 聊天内容在 txt 文件中，执行成功后结果也追加到 txt中.
下面是 txt 定义的 ai chat格式，支持文本和多媒体文件等:
::>title: 标题
::>system: 系统提示, 可以多行
::>user: 用户请求，可以多行
::>response: AI响应，可以多行
::>user: 用户请求，可以多行
::>attach: filename : mime: 本地文件引用
::>response: AI响应，可以多行
::>attach: ... 服务器返回的多媒体文件内容...对应的本地文件引用
...

ai聊天软件：
1. 支持两种模式: 客户端和服务器模式, 
2. 服务端运行方式为 -d, 运行在 linux 上监听tcp 9501端口
    它会监听端口接受连接记录状态到 sqlite中。
    配置 - config.yaml:
          server_type   <openai|openroute|gemini>  支持的 ai server类型
          server_url       <api url>
          server_token  <api token>
          server_ssl       <ssl私钥文件路径，用于认证>
          default_model  <默认的ai 模型>

    支持命令(设计报文格式使得易用并且容易扩展), 注意所有的 chat .txt 文件存储时都是按 uuid .txt存储避免文件名冲突:           
           exec [model name]  <文本内容> 将文本内容转换成 ai 请求并可以指定模型发送到 ai server,
          list [时间范围，单位是 分钟] 查看任务状态
          get uuid 下载一个 ai chat.txt
          delete uuid: 删除一个uuid
 
2. 客户端模式, 支持发送和 tui 方式管理模式， tui 里面可以做所有操作， 命令行一次只能执行一个操作
    运行方式:
    <ai chat .txt>   [ file ... ] - 将 ai chat 发送给 server, 可以带一个或是多个文件附件
     -t  - tui模式，
    l | list   [时间范围]               - 查询处理状态, 状态包括(uuid, 发送时间，收到ai响应时间，客户端ipv4, 标题（在ai chat.txt中），处理结果), 时间可以省略
    get uuid  - 下载完成后的 ai chat.txt
    delete uuid. - 删除一个ai chat.txt
    resend uuid - 重新发送一个 ai chat.txt
```
# 下面是初步设计， 请根据需求和初步设计，根据高內聚低耦合容易维护扩展的指导方式设计完整方案。代码有良好的模块化，分目录存放。：

### 需求分析与改进建议

1. **协议设计优化**：
   - 增加元数据行：`::>uuid:` 和 `::>created_at:` 用于追踪记录
   - 多媒体附件建议增加`file_hash`字段验证完整性

2. **服务器模式增强**：
   - 添加请求队列系统和重试机制
   - 支持限流和优先级队列（VIP用户）
   - 增加`status`字段（pending/processing/completed/failed）

3. **客户端改进**：
   - 支持附件批量上传（zip打包）
   - 添加进度条显示（上传/下载）
   - TUI模式增加实时聊天预览

4. **安全扩展**：
   - 支持TLS加密通信
   - 添加API请求签名验证
   - SQLite数据库加密选项

### 系统架构设计

```
ai-chat-rs/
├── Cargo.toml
├── config/
│   └── config.yaml       # 示例配置文件
├── src/
│   ├── main.rs           # 入口点
│   ├── common/           # 通用模块
│   │   ├── mod.rs
│   │   ├── config.rs     # 配置加载
│   │   ├── protocol.rs   # 协议解析/生成
│   │   └── crypto.rs     # 加密工具
│   ├── server/
│   │   ├── mod.rs        # 服务器主逻辑
│   │   ├── api_handler.rs # API处理器
│   │   ├── database.rs   # SQLite操作
│   │   └── ai_client.rs  # AI服务适配器
│   ├── client/
│   │   ├── mod.rs        # 客户端主逻辑
│   │   ├── tui/          # TUI界面
│   │   │   ├── app.rs
│   │   │   ├── ui.rs
│   │   │   └── handler.rs
│   │   └── cli.rs        # 命令行处理
│   └── models/
│       ├── mod.rs
│       ├── chat_log.rs   # 聊天记录结构
│       └── command.rs    # 命令枚举
```

### 核心模块设计

#### 1. 协议解析 (`common/protocol.rs`)
```rust
pub struct ChatLog {
    pub uuid: Uuid,
    pub title: String,
    pub system_prompt: String,
    pub interactions: Vec<Interaction>,
    pub attachments: Vec<Attachment>,
}

pub enum Interaction {
    User(String),
    AI(String),
}

pub struct Attachment {
    pub filename: PathBuf,
    pub mime_type: String,
    pub content: Vec<u8>,
}

impl ChatLog {
    pub fn from_str(data: &str) -> Result<Self> {
        // 解析文本格式
    }
  
    pub fn to_string(&self) -> String {
        // 生成文本格式
    }
}
```

#### 2. 服务器主循环 (`server/mod.rs`)
```rust
async fn run_server(config: &Config) -> Result<()> {
    let listener = TcpListener::bind("0.0.0.0:9501").await?;
    let db = Database::connect(&config.database_path).await?;
  
    while let Ok((stream, _)) = listener.accept().await {
        let config = config.clone();
        let db = db.clone();
        tokio::spawn(async move {
            handle_connection(stream, config, db).await;
        });
    }
}
```

#### 3. AI客户端适配器 (`server/ai_client.rs`)
```rust
#[async_trait]
trait AIClient {
    async fn send_request(&self, messages: Vec<Message>) -> Result<String>;
}

struct OpenAIClient {
    api_key: String,
    model: String,
}

#[async_trait]
impl AIClient for OpenAIClient {
    async fn send_request(&self, messages: Vec<Message>) -> Result<String> {
        // 调用OpenAI API
    }
}

// Gemini和OpenRoute的类似实现
```

#### 4. TUI界面 (`client/tui/app.rs`)
```rust
pub struct App {
    pub logs: Vec<ChatLogPreview>,
    pub selected: usize,
    pub mode: Mode, // Browse, Chat, Help
}

pub fn run_tui(config: &Config) -> Result<()> {
    let mut app = App::new();
    loop {
        terminal.draw(|f| ui::render(f, &app))?;
        match event::read()? {
            Event::Key(key) => handler::handle_key(&mut app, key),
            // 其他事件处理
        }
    }
}
```

### 通信协议设计

使用简单的TLV（Type-Length-Value）格式：

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+---------------+---------------+-------------------------------+
|     Type      |                  Length (u32)                 |
+---------------+---------------+-------------------------------+
|                           Payload ...                         |
+---------------------------------------------------------------+
```

命令类型枚举：
```rust
enum CommandType {
    Exec = 0x01,
    List = 0x02,
    Get  = 0x03,
    Delete = 0x04,
    Resend = 0x05,
    Response = 0x80,
    Error = 0xFF,
}
```

### 数据库设计 (SQLite)

```sql
CREATE TABLE chat_logs (
    uuid TEXT PRIMARY KEY,
    client_ip TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    title TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    model TEXT NOT NULL
);

CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    log_uuid TEXT REFERENCES chat_logs(uuid),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_hash BLOB NOT NULL
);
```

### 配置示例 (`config/config.yaml`)
```yaml
server:
  type: "openai"
  url: "https://api.openai.com/v1/chat/completions"
  token: "sk-xxxxxxxxxx"
  ssl_cert: "/path/to/cert.pem"
  default_model: "gpt-4-turbo"

storage:
  database: "chats.db"
  chat_dir: "./chats"
  attachment_dir: "./attachments"

rate_limit:
  requests_per_minute: 30
  max_concurrent: 5
```

### 执行流程示例

**客户端发送请求**:
```bash
$ ai-chat-rs client -t  # 进入TUI模式
# 或
$ ai-chat-rs exec "解释量子力学" -f diagram.png -f notes.txt
```

**服务器处理流程**:
1. 接收TCP连接
2. 解析TLV格式请求
3. 验证API密钥
4. 保存聊天记录到SQLite
5. 队列系统处理请求
6. 调用对应AI服务
7. 结果追加到文本文件
8. 更新数据库状态
9. 返回响应给客户端

### 扩展性设计

1. **插件化AI服务**：
   ```rust
   trait AIService {
       fn name(&self) -> &str;
       async fn process(&self, request: AIRequest) -> Result<AIResponse>;
   }
   ```

2. **可替换存储后端**：
   ```rust
   trait StorageBackend {
       async fn save_log(&self, log: &ChatLog) -> Result<()>;
       async fn get_log(&self, uuid: &Uuid) -> Result<ChatLog>;
   }
   ```

3. **协议版本控制**：
   - 在TLV头添加版本字段
   - 支持向后兼容的协议升级

### 安全措施

1. 客户端-服务器通信：使用TLS 1.3加密
2. API请求：HMAC签名
3. 文件存储：SHA-256校验
4. 数据库：SQLCipher加密
5. 输入验证：严格的协议解析

这个设计提供了：
- 清晰的模块分离
- 可扩展的架构
- 高效的数据处理
- 用户友好的TUI界面
- 企业级的安全特性

需要进一步实现的关键点：
1. 异步任务调度系统
2. TUI的实时更新机制
3. 多媒体处理管道
4. 详细的错误处理和日志系统
5. 全面的单元测试覆盖

---
非常出色的初步设计！你已经为这个项目奠定了坚实的基础，涵盖了核心需求、模块划分和技术选型。你的改进建议也非常到位，特别是关于元数据、队列系统和安全性的考量。

在此基础上，我将根据**高内聚、低耦合、易维护、易扩展**的原则，为你提供一个更完整和详细的系统设计方案。我们将深化模块职责、细化通信协议，并明确关键的实现路径。

---

### **设计哲学与最终目标**

*   **高内聚 (High Cohesion):** 每个模块只做一件事，并把它做好。例如，`protocol`模块只关心数据的序列化和反序列化，不关心网络传输或数据库存储。
*   **低耦合 (Low Coupling):** 模块之间通过定义良好的接口（如`trait`）进行交互，而不是依赖具体的实现。这使得替换AI服务、数据库或UI变得容易。
*   **可测试性 (Testability):** 清晰的模块边界和接口使得单元测试和集成测试更容易编写。
*   **可扩展性 (Extensibility):** 设计应能轻松支持新的AI模型、新的命令和新的功能，而无需大规模重构。

---

### **1. 最终系统架构与模块职责**

你提出的目录结构非常好，我们来进一步明确每个模块的职责。

```
ai-chat-rs/
├── Cargo.toml
├── README.md               # 项目介绍、构建和运行指南
├── config.yaml             # 默认配置文件模板
├── data/                   # 运行时生成的数据目录
│   ├── chats/              # 存放 .txt 聊天文件的目录 (按uuid命名)
│   ├── attachments/        # 存放附件的目录
│   └── chat_main.db        # SQLite 数据库文件
├── src/
│   ├── main.rs             # 程序入口，解析命令行参数，启动客户端或服务器
│   ├── error.rs            # 定义全局统一的错误类型和 Result
│   │
│   ├── common/             # 跨客户端和服务器的通用代码
│   │   ├── mod.rs
│   │   ├── protocol.rs     # 核心：.txt 聊天格式的解析和生成
│   │   └── types.rs        # 核心：定义所有命令、响应、状态等共享数据结构
│   │
│   ├── server/
│   │   ├── mod.rs          # 服务器启动和主循环逻辑
│   │   ├── listener.rs     # 监听TCP连接，并将新连接交给处理器
│   │   ├── handler.rs      # 处理单个客户端连接，解析命令，派发任务
│   │   ├── worker.rs       # **核心：后台任务处理器**，从队列中取任务与AI交互
│   │   ├── db.rs           # 数据库操作模块 (CRUD for chat_logs)
│   │   └── ai_gateway/     # AI服务适配器（网关）
│   │       ├── mod.rs      # 定义 AIClient trait 和工厂函数
│   │       ├── openai.rs   # OpenAI 客户端实现
│   │       └── gemini.rs   # Gemini 客户端实现等
│   │
│   ├── client/
│   │   ├── mod.rs          # 客户端主逻辑
│   │   ├── cli.rs          # 命令行模式的实现
│   │   ├── network.rs      # 客户端网络通信，封装与服务端的交互
│   │   └── tui/            # TUI 界面
│   │       ├── mod.rs      # TUI 启动和主循环
│   │       ├── app.rs      # TUI 的状态管理
│   │       ├── ui.rs         # TUI 界面绘制逻辑
│   │       └── event.rs      # TUI 事件处理（键盘、网络响应等）
│
└── tests/                  # 测试目录
    ├── protocol_tests.rs
    └── ...                 # 其他单元测试和集成测试
```

### **2. 数据格式与协议深化**

#### **2.1. 增强的 `.txt` 聊天格式**

为了更好的追踪和可移植性，我们在文件中直接加入元数据。

```txt
::>uuid: 550e8400-e29b-41d4-a716-446655440000
::>title: 关于量子力学的解释请求
::>created_at: 2023-10-27T10:00:00Z
::>model: gpt-4-turbo
::>status: completed
::>system: 你是一个物理学家，请用通俗易懂的语言解释。
::>user: 什么是量子叠加态？
::>response: 量子叠加态是...
::>user: 给我一个关于猫的比喻。
::>attach: schrodingers_cat.png : image/png
::>response: 好的，著名的“薛定谔的猫”思想实验就是一个绝佳的比喻...
::>attach: server_response_diagram.svg : image/svg+xml
```

*   **新增字段**: `uuid`, `created_at`, `model`, `status`。这使得每个 `.txt` 文件都是一个独立的、自包含的记录。
*   **附件格式**: `::>attach: filename : mime_type` 保持不变，非常清晰。

#### **2.2. 客户端/服务器通信协议 (TLV 演进)**

使用 TLV 是个好主意，因为它简单且可扩展。我们将它具体化，并设计为**流式多包**模式，以支持大文件传输。

一个逻辑请求可以由多个 TLV 包组成。

**TLV 包结构:**

```
| 1 byte (Type) | 4 bytes (Length, Big Endian) | N bytes (Value) |
```

**命令与数据类型 (`Type` in `types.rs`):**

```rust
// src/common/types.rs
#[repr(u8)]
pub enum PacketType {
    // Client to Server
    CmdExec = 0x01,        // 执行请求，Value是 ChatLog 的元数据 (JSON/Bincode)
    CmdList = 0x02,        // 列表请求，Value是 ListRequestOptions
    CmdGet = 0x03,         // 获取请求，Value是 UUID
    CmdDelete = 0x04,      // 删除请求，Value是 UUID
    CmdResend = 0x05,      // 重发请求，Value是 UUID
    AttachmentChunk = 0x10, // 附件数据块，Value是文件内容

    // Server to Client
    Ack = 0x80,            // 成功确认，Value是相关信息 (如新任务的UUID)
    ResponseList = 0x81,   // 列表响应，Value是任务列表 (JSON)
    ResponseChatLog = 0x82, // Get/Exec的最终结果，Value是完整的 chat.txt 内容
    Error = 0xFF,          // 错误响应，Value是错误信息字符串
}
```

**执行流程示例 (`exec` 命令带附件):**

1.  **客户端 -> 服务器 (Packet 1): `CmdExec`**
    *   `Type`: `0x01`
    *   `Length`: `Value`的长度
    *   `Value`: `ChatLog`结构体（不含`interactions`和`attachments`内容，只有元数据，如标题、指定模型等）序列化后的`JSON`字符串。
      ```json
      { "title": "...", "model": "gpt-4", "attachments": [{"filename": "cat.png", "mime": "image/png", "size": 10240, "hash": "sha256_hash_here"}] }
      ```

2.  **服务器 -> 客户端 (Packet 2): `Ack`**
    *   `Type`: `0x80`
    *   `Value`: 新创建的任务 `UUID`。

3.  **客户端 -> 服务器 (Packet 3...N): `AttachmentChunk`**
    *   对每个附件，客户端开始发送`AttachmentChunk`包。可以设定一个合理的块大小（如 64KB）。
    *   `Type`: `0x10`
    *   `Value`: `{"uuid": "...", "filename": "cat.png", "chunk_index": 0, "data": "..."}`。数据部分可以用`base64`编码。

4.  **服务器处理**: 服务器接收所有块，验证哈希，然后将任务放入后台队列。

5.  **服务器 -> 客户端 (最终响应): `ResponseChatLog`**
    *   任务完成后，服务器通过一个持久连接或在客户端下次查询时，发送完整的 `.txt` 文件。
    *   `Type`: `0x82`
    *   `Value`: 完整的 `uuid.txt` 文件内容（UTF-8字符串）。

### **3. 核心模块设计详述**

#### **`server/worker.rs` (后台任务处理器)**

这是服务器的心脏，它将网络IO与耗时的AI请求解耦。

```rust
// src/server/worker.rs
use tokio::sync::mpsc; // 使用MPSC通道作为任务队列

pub struct AiTask {
    pub uuid: Uuid,
    pub chat_log: ChatLog, // 解析后的聊天记录
}

pub async fn run_worker_pool(
    db: Arc<Database>,
    config: Arc<Config>,
    mut rx: mpsc::Receiver<AiTask>,
) {
    // 可以启动一个或多个worker协程来并行处理
    while let Some(task) = rx.recv().await {
        let db = db.clone();
        let config = config.clone();
        tokio::spawn(async move {
            process_task(db, config, task).await;
        });
    }
}

async fn process_task(db: Arc<Database>, config: Arc<Config>, task: AiTask) {
    // 1. 更新数据库状态为 'processing'
    db.update_status(&task.uuid, "processing").await.ok();

    // 2. 根据 config 和 task.chat_log.model 创建 AI Gateway 实例
    let ai_client = ai_gateway::create_client(&config, task.chat_log.model.as_deref());

    // 3. 构造发送给 AI 的消息体
    let messages = convert_to_ai_messages(&task.chat_log);

    // 4. 发送请求
    match ai_client.send_request(messages).await {
        Ok(ai_response) => {
            // 5a. 成功：将AI响应和可能的附件追加到 chat_log 结构体
            let mut final_log = task.chat_log;
            final_log.interactions.push(Interaction::AI(ai_response));
            
            // 6a. 将更新后的 chat_log 写回 uuid.txt 文件
            // ... fs::write ...

            // 7a. 更新数据库状态为 'completed'
            db.update_status(&task.uuid, "completed").await.ok();
        }
        Err(e) => {
            // 5b. 失败：记录错误，更新数据库状态为 'failed'
            db.update_status_with_error(&task.uuid, "failed", &e.to_string()).await.ok();
        }
    }
}
```

#### **`server/ai_gateway/mod.rs` (AI服务适配器)**

使用`trait`实现多AI服务支持。

```rust
// src/server/ai_gateway/mod.rs
use async_trait::async_trait;

#[async_trait]
pub trait AiClient {
    async fn send_request(&self, messages: Vec<Message>) -> Result<String, AiError>;
}

// 工厂函数，根据配置创建具体的客户端实例
pub fn create_client(config: &Config, model: Option<&str>) -> Box<dyn AiClient + Send + Sync> {
    let server_type = &config.server.type;
    match server_type.as_str() {
        "openai" => Box::new(OpenAiClient::new(&config.server.token, model.unwrap_or(&config.server.default_model))),
        "gemini" => Box::new(GeminiClient::new(/*...*/)),
        _ => panic!("Unsupported AI server type"),
    }
}
```

#### **`client/tui/app.rs` (TUI 状态管理)**

`ratatui` (tui-rs的社区分支) 是一个优秀的选择。

```rust
// src/client/tui/app.rs

// 列表项的预览信息
pub struct TaskPreview {
    pub uuid: Uuid,
    pub title: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

// TUI 的两种主要视图模式
pub enum AppMode {
    TaskList,       // 任务列表视图
    ChatView,       // 聊天内容视图
    // ... 可以增加 Help, Input 等模式
}

// TUI 的核心状态
pub struct App {
    pub mode: AppMode,
    pub tasks: Vec<TaskPreview>,
    pub selected_task_index: usize,
    pub current_chat_content: String, // 用于在ChatView中显示内容
    pub is_loading: bool,             // 是否正在与服务器通信
    pub error_message: Option<String>,
}

impl App {
    pub fn new() -> Self { /* ... */ }
    
    // 网络请求会改变状态，例如
    pub async fn refresh_tasks(&mut self, network_client: &mut NetworkClient) {
        self.is_loading = true;
        // ... draw UI to show loading spinner ...
        match network_client.list_tasks().await {
            Ok(tasks) => self.tasks = tasks,
            Err(e) => self.error_message = Some(e.to_string()),
        }
        self.is_loading = false;
    }
}
```

### **4. 数据库设计 (SQLite)**

你的设计很好，我稍作补充，增加错误信息和完成时间。

```sql
CREATE TABLE IF NOT EXISTS chat_logs (
    uuid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client_ip TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    model_used TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_at DATETIME, -- 开始处理的时间
    finished_at DATETIME,   -- 完成或失败的时间
    error_message TEXT      -- 如果失败，记录错误原因
);

-- 附件表保持不变，很好。
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_uuid TEXT NOT NULL REFERENCES chat_logs(uuid) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_hash TEXT NOT NULL, -- 使用TEXT存储HEX编码的SHA256哈希值
    file_path_on_server TEXT NOT NULL -- 附件在服务器上的存储路径
);
```

### **5. 安全性考量**

1.  **TLS加密通信**: 客户端和服务器之间的所有TCP通信都应强制使用TLS。`rustls` 和 `tokio-rustls` 是纯Rust实现，是不错的选择。服务器需要配置私钥和证书。
2.  **输入验证**:
    *   严格解析TLV包，防止缓冲区溢出。
    *   文件名清理：绝不允许 `../` 等路径遍历字符。只保留文件名本身，服务器统一存储在 `data/attachments/` 目录下。
    *   数据库查询：使用参数化查询（`sqlx`默认支持），防止SQL注入。
3.  **身份验证**: 你的初步设计中缺少这一点。一个简单有效的方式是：
    *   在`config.yaml`中为服务器设置一个`auth_token`。
    *   客户端在每次连接后，发送的第一个包必须是认证包，内容为这个`auth_token`。服务器验证通过后才处理后续命令。
4.  **资源限制**:
    *   限制单个请求的附件总大小和数量。
    *   使用`tokio`的信号量（`Semaphore`）来限制并发处理的任务数量，防止AI API被过度调用。

### **6. 建议使用的关键Crates**

*   **网络**: `tokio` (异步运行时), `tokio-rustls` (TLS)。
*   **命令行**: `clap` (功能强大，带派生宏)。
*   **配置**: `serde` (序列化/反序列化), `serde_yaml`。
*   **数据库**: `sqlx` (异步，编译时检查SQL，带连接池)。
*   **协议/数据**: `uuid` (生成UUID), `serde_json` 或 `bincode` (用于TLV的Value序列化)。
*   **TUI**: `ratatui` (UI绘制), `crossterm` (终端控制)。
*   **HTTP客户端 (for AI Gateway)**: `reqwest` (简单易用的HTTP客户端)。
*   **错误处理**: `thiserror` (定义自定义错误类型)。

---

### **总结**

这个完善后的设计方案，在你的优秀初稿之上，构建了一个健壮、可扩展且安全的系统蓝图。

*   **解耦**: 网络层、业务逻辑（worker）、AI网关和数据存储完全分离。
*   **健壮性**: 后台任务队列确保了即使AI请求缓慢或失败，服务器本身也不会被阻塞。
*   **可扩展性**: 添加新的AI服务只需实现`AiClient` trait；添加新命令只需在`PacketType`枚举和`handler`中增加分支。
*   **用户体验**: TUI模式提供了丰富的交互，而CLI模式则保证了脚本化的便利。
*   **安全性**: 涵盖了传输加密、认证和输入验证等基本方面。

下一步就是按照这个设计，从 `common/types.rs` 和 `common/protocol.rs` 开始，逐步实现每个模块，并为它们编写单元测试。祝你编码愉快！