// @file: common/i18n/zh-CN.ts
// Chinese (Simplified) locale strings.
//
// Key naming convention:  <domain>.<section>.<item>
// Interpolation syntax:   {param}  e.g. '已导入 {count} 个 Skill'

export const zhCN = {

    // ── Skill type labels ───────────────────────────────────────────────────
    'skillType.prompt':         'Prompt',
    'skillType.shell':          'Shell',
    'skillType.mcp':            'MCP',
    'skillType.http':           'HTTP',
    'skillType.builtin':        'Builtin',
    'skillType.custom':         'Custom',

    'skillType.prompt.desc':    'Markdown 指令注入',
    'skillType.shell.desc':     '本地命令执行',
    'skillType.mcp.desc':       '引用 MCP Server 工具',
    'skillType.http.desc':      '远程 REST 端点',
    'skillType.builtin.desc':   '代码内置函数',
    'skillType.custom.desc':    '自定义扩展',

    // ── MCP transport ───────────────────────────────────────────────────────
    'mcpTransport.stdio':       'Stdio (本地进程)',
    'mcpTransport.sse':         'SSE (HTTP 流)',
    'mcpTransport.http':        'HTTP (REST)',

    'mcpTransport.stdio.option':'Stdio — 启动本地进程',
    'mcpTransport.sse.option':  'SSE — Server-Sent Events',
    'mcpTransport.http.option': 'HTTP — REST 端点',

    // ── Model capability labels ─────────────────────────────────────────────
    'model.capability.vision':           '视觉',
    'model.capability.thinking':         '思考',
    'model.capability.tools':            '工具',
    'model.capability.audio':            '音频',
    'model.capability.video':            '视频',
    'model.capability.structuredOutput': '结构化输出',

    // ── Model category labels ───────────────────────────────────────────────
    'model.category.chat':      '对话',
    'model.category.image':     '文生图',
    'model.category.video':     '视频生成',
    'model.category.audio':     '语音',
    'model.category.embedding': '向量嵌入',

    // ── Status ──────────────────────────────────────────────────────────────
    'status.connected':  '已连接',
    'status.error':      '错误',
    'status.idle':       '未连接',
    'status.enabled':    '启用',
    'status.disabled':   '停用',
    'status.loading':    '加载中…',
    'status.testing':    '测试中…',
    'status.noDesc':     '暂无描述',
    'status.noContent':  '暂无内容',

    // ── Common actions ──────────────────────────────────────────────────────
    'action.add':         '添加',
    'action.new':         '新建',
    'action.delete':      '删除',
    'action.save':        '保存',
    'action.cancel':      '取消',
    'action.confirm':     '确认',
    'action.import':      '导入',
    'action.export':      '导出',
    'action.test':        '测试',
    'action.edit':        '编辑',
    'action.copy':        '复制',
    'action.close':       '关闭',
    'action.rename':      '重命名',
    'action.refresh':     '刷新',

    // ── Common tooltips ─────────────────────────────────────────────────────
    'tooltip.dblClickRename':   '双击重命名',
    'tooltip.clickEditName':    '点击编辑名称，Enter 或失焦保存',
    'tooltip.clickEditIcon':    '点击选择图标',
    'tooltip.testConnection':   '发送空请求测试连通性',

    // ── Icon picker ──────────────────────────────────────────────────────────
    'iconPicker.pasteLabel':       '粘贴图标',
    'iconPicker.pastePlaceholder': '输入 emoji',
    'iconPicker.systemLabel':      '系统图标',
    'iconPicker.useDefault':       '使用默认图标',

    // ── Common form labels ──────────────────────────────────────────────────
    'form.name':         '名称',
    'form.icon':         '图标',
    'form.iconHint':     'emoji',
    'form.description':  '描述',
    'form.type':         '类型',
    'form.enabled':      '启用',
    'form.endpoint':     'Endpoint URL',
    'form.method':       'Method',
    'form.auth':         'Authorization',
    'form.authHint':     '可选',
    'form.headers':      '额外请求头',
    'form.headersHint':  'JSON，不含 Authorization',
    'form.params':       'Parameters Schema',
    'form.timeout':      '超时时间 (秒)',
    'form.autoConnect':  '启动时自动连接',

    // ── Common dialogs ──────────────────────────────────────────────────────
    'dialog.delete.title':   '删除确认',
    'dialog.import.action':  '导入',
    'dialog.import.hint':    '粘贴 JSON 数组或单个对象',

    // ── Skill editor ────────────────────────────────────────────────────────
    'skill.header':              'Skills',
    'skill.addNew':              '新建 Skill',
    'skill.importConfig':        '导入配置',
    'skill.exportAll':           '导出全部',

    'skill.empty.text':          '暂无 Skill',
    'skill.empty.action':        '新建第一个',
    'skill.select.title':        '选择一个 Skill',
    'skill.select.desc':         'Skills 让 LLM 能够调用 HTTP API、内置函数或自定义代码',
    'skill.select.action':       '新建 Skill',

    'skill.enabled.label':       '启用此 Skill',
    'skill.placeholder.name':    'My Skill',
    'skill.placeholder.desc':    '简述此 Skill 的功能',
    'skill.placeholder.auth':    'Bearer sk-...',
    'skill.placeholder.headers': '{"X-Custom-Header": "value"}',
    'skill.placeholder.endpoint':'https://api.example.com/skill',

    'skill.section.basic':       '基础信息',
    'skill.section.trigger':     '触发行为',
    'skill.section.prompt':      'Markdown 指令',
    'skill.section.shell':       'Shell 命令',
    'skill.section.mcp':         'MCP 工具引用',
    'skill.section.http':        'HTTP 端点配置',
    'skill.section.params':      'Parameters Schema',

    'skill.trigger.strategyLabel':       '触发策略',
    'skill.trigger.reference.desc':      '语义/Glob 自动触发',
    'skill.trigger.action.desc':         '仅手动 slash 命令触发',
    'skill.trigger.priorityLabel':       '优先级',
    'skill.trigger.priorityHint':        '0-100，越小越优先',
    'skill.trigger.autoLoadLabel':       '会话启动时自动加载',
    'skill.trigger.disableModelLabel':   '禁止模型通过 load_skill 加载（action 专用）',
    'skill.trigger.globsLabel':          'Glob 自动挂载',
    'skill.trigger.globsHint':           '每行一个，文件打开时自动加载此 skill',
    'skill.trigger.correctionLogLabel':  '修正日志路径',
    'skill.trigger.correctionLogHint':   '相对项目根，如 docs/corrections.md',

    'skill.hint.prompt':         '此内容将注入到 LLM 的 system prompt。适合编写操作规范、代码风格约定、领域知识等。',
    'skill.hint.shell':          'LLM 传入的参数会替换 {{argName}} 占位符后执行。在 Parameters Schema 中定义参数格式。',
    'skill.hint.params':         '留空则 LLM 将以无参数形式调用此 Skill',
    'skill.hint.mcpParams':      '参数 Schema 由 MCP Server 的工具定义自动提供，无需手动填写。',
    'skill.hint.mcpDesc':        '选择已配置的 MCP Server 和具体工具。端点、认证、参数 Schema 自动继承——比 HTTP Skill 更简洁。',
    'skill.hint.noMcpServer':    '尚无配置的 MCP Server，请先在 MCP Servers 标签页中添加',
    'skill.hint.noMcpTools':     '（该服务器暂无工具，请先连接）',
    'skill.hint.mcpAutoParams':  '参数 Schema 由 MCP Server 的工具定义自动提供，无需手动填写。',

    'skill.mcp.serverLabel':     'MCP Server',
    'skill.mcp.serverEmpty':     '— 选择服务器 —',
    'skill.mcp.toolLabel':       '工具',
    'skill.mcp.toolEmpty':       '— 选择工具 —',

    'skill.shell.commandLabel':  '命令模板',
    'skill.shell.commandHint':   '支持 {{argName}} 占位符',
    'skill.shell.placeholder':   'git log --oneline -{{n}} -- {{path}}',

    'skill.param.placeholder':   '{\n  "type": "object",\n  "properties": {\n    "query": {\n      "type": "string",\n      "description": "搜索关键词"\n    }\n  },\n  "required": ["query"]\n}',

    'skill.import.fileLabel':    '从文件导入',
    'skill.import.fileTooltip':  '从 .json 文件导入（支持多选）',
    'skill.placeholder.instructions': '# 操作规范\n\n- 永远使用 TypeScript strict 模式\n- 函数不超过 30 行\n...',
    'skill.import.pasteTooltip': '粘贴 JSON 导入',
    'skill.import.readError':    '{filename}: 读取失败',

    'skill.toast.saved':         '已保存',
    'skill.toast.deleted':       '已删除',
    'skill.toast.imported':      '已导入 {count} 个 Skill',
    'skill.toast.invalidJson':   'JSON 格式错误',
    'skill.toast.invalidParams': 'Parameters 不是合法 JSON',
    'skill.toast.invalidHeaders':'Headers 不是合法 JSON',
    'skill.toast.testNotHttp':   '测试功能仅支持 HTTP 类型 Skill',
    'skill.toast.testPrompt':    'Prompt 类型 Skill 内容直接注入 system prompt，无需测试',
    'skill.toast.testMcp':       'MCP Skill 通过 MCP Server 连接测试，请在 MCP Servers 标签页中测试服务器连通性',
    'skill.toast.testNoEndpoint':'请先保存 Endpoint URL',
    'skill.toast.testSuccess':   '连接成功 (HTTP {status})',
    'skill.toast.testFailed':    'HTTP {status} — 请检查 Endpoint',
    'skill.toast.testError':     '连接失败: {message}',

    'skill.confirm.delete':      '确定要删除此 Skill？此操作不可撤销。',
    'skill.import.title':        '导入 Skills',
    'skill.import.placeholder':  '[{"name":"My Skill","type":"http","endpoint":"..."}]',

    // ── MCP editor ──────────────────────────────────────────────────────────
    'mcp.header':                'MCP Servers',
    'mcp.addNew':                '添加服务器',
    'mcp.importConfig':          '导入配置',
    'mcp.exportAll':             '导出全部',

    'mcp.empty.text':            '暂无 MCP Server',
    'mcp.empty.action':          '添加第一个',
    'mcp.select.title':          '选择一个 MCP Server',
    'mcp.select.desc':           'MCP (Model Context Protocol) 让 LLM 访问外部工具和数据源',
    'mcp.select.action':         '添加服务器',

    'mcp.placeholder.name':      'My MCP Server',
    'mcp.placeholder.desc':      '简短描述此服务器的用途',
    'mcp.placeholder.command':   'node / python / npx',
    'mcp.placeholder.args':      'server.js --port 3000',
    'mcp.placeholder.cwd':       '/path/to/project',
    'mcp.placeholder.endpoint':  'http://localhost:3000/mcp',
    'mcp.placeholder.apiKey':    'sk-...',

    'mcp.section.basic':         '基础信息',
    'mcp.section.transport':     '连接方式',
    'mcp.section.advanced':      '高级选项',
    'mcp.section.tools':         'Tools',
    'mcp.section.resources':     'Resources',

    'mcp.transport.label':       '传输协议',
    'mcp.command.label':         '命令',
    'mcp.command.hint':          'Command',
    'mcp.args.label':            '参数',
    'mcp.args.hint':             'Args（空格分隔）',
    'mcp.cwd.label':             '工作目录',
    'mcp.cwd.hint':              'CWD（可选）',
    'mcp.apiKey.label':          'API Key',
    'mcp.apiKey.hint':           '可选',

    'mcp.tools.addBtn':          '+ 手动添加',
    'mcp.tools.hint':            '连接成功后自动发现。也可手动定义供 MCP Skill 引用。',
    'mcp.tools.empty':           '暂无工具',
    'mcp.tools.noDesc':          '无描述',
    'mcp.resources.addBtn':      '+ 添加',
    'mcp.resources.empty':       '暂无资源',

    'mcp.addTool.title':         '手动添加工具',
    'mcp.addTool.nameLabel':     '工具名称',
    'mcp.addTool.namePlaceholder':'get_weather',
    'mcp.addTool.namehint':      'snake_case',
    'mcp.addTool.descLabel':     '描述',
    'mcp.addTool.descPlaceholder':'查询指定城市的实时天气',

    'mcp.addResource.title':     '添加资源',
    'mcp.addResource.uriLabel':  'URI',
    'mcp.addResource.uriPlaceholder': 'file:///path/to/resource',
    'mcp.addResource.nameLabel': '名称',
    'mcp.addResource.namePlaceholder': '显示名称',

    'mcp.toast.saved':           '已保存',
    'mcp.toast.deleted':         '已删除',
    'mcp.toast.imported':        '已导入 {count} 个服务器',
    'mcp.toast.invalidJson':     'JSON 格式错误',
    'mcp.toast.testSuccess':     '连接成功 (HTTP {status})',
    'mcp.toast.testFailed':      'HTTP {status} — 请检查 Endpoint 和认证信息',
    'mcp.toast.testError':       '连接失败: {message}',
    'mcp.toast.testStdio':       'Stdio 服务器由应用程序管理连接，请检查 autoConnect 选项或手动启动进程',
    'mcp.toast.testNoEndpoint':  '请先配置 Endpoint URL',

    'mcp.confirm.delete':        '确定要删除此 MCP Server？',
    'mcp.import.title':          '导入 MCP 配置',
    'mcp.import.hint':           '粘贴 JSON 数组（单个对象也支持）',
    'mcp.import.placeholder':    '[{"name":"My Server","transport":"stdio",...}]',

    // ── Chat input — Thinking mode ───────────────────────────────────────────
    'thinking.label':            '深度思考',
    'thinking.tooltip':          '启用/关闭深度思考模式',
    'thinking.effort.label':     '思考强度',
    'thinking.effort.auto':      '自动',
    'thinking.effort.low':       '低',
    'thinking.effort.medium':    '中',
    'thinking.effort.xhigh':     '极高',
    'thinking.toggle.on':        '关闭思考',
    'thinking.toggle.off':       '开启思考',

    // ── Chat input — Mode toggle ─────────────────────────────────────────────
    'chatInput.agentMode':       'Agent 模式',
    'chatInput.agentMode.tooltip': '启用多轮 Agent 循环与工具调用',

    // ── Chat input — OCR (image to text) ─────────────────────────────────────
    'chatInput.ocr':             '提取文字',
    'chatInput.ocr.tooltip':     '从图片中提取文字（OCR）',
    'chatInput.ocr.processing':  '识别中…',
    'chatInput.ocr.review.title': '提取结果（可编辑）',
    'chatInput.ocr.review.confirm': '插入并移除图片',
    'chatInput.ocr.review.confirmKeep': '插入并保留图片',
    'chatInput.ocr.retry':       '重试',
    'chatInput.ocr.cancel':      '取消',
    'chatInput.ocr.failed':      '识别失败',
    'chatInput.ocr.empty':       '未识别到文字',
    'chatInput.ocr.all':         '全部提取文字',
    'chatInput.ocr.all.tooltip': '批量识别所有图片并插入文字',
    'chatInput.ocr.all.done':    '已处理 {done}/{total} 张图片',

    // ── Chat input — "+" add-source menu ─────────────────────────────────────
    'chatInput.add.menu':        '添加内容',
    'chatInput.add.camera':      '拍照',
    'chatInput.add.photoAlbum':  '相册',
    'chatInput.add.attach':      '上传附件',
    'chatInput.add.fileRef':     '引用文件',

    // ── HITL (human-in-the-loop) input banner ────────────────────────────────
    'hitl.inputPlaceholder':    '输入你的回答\u2026',
    'hitl.submit':              '回应',

    // ── Harness status bar ────────────────────────────────────────────────────
    'harness.statusBar.toolsLabel':  'Tools',
    'harness.statusBar.done':        '{count} done',
    'harness.statusBar.budgetWarn':  '{resource} {pct}%',
    'harness.statusBar.compressed':  '\u2193 compressed ({layerName}, \u2212{savedTokens} tokens)',
    'harness.statusBar.skillLoaded': '{skillId}',

    // ── Background session notifications ──────────────────────────────────────
    'session.ttyActive':             '后台会话正在运行交互命令: {command}',
    'session.ttyActive.switchView':  '切换查看',
    'session.hitlActive':            '后台会话等待输入: {question}',
    'session.hitlActive.switch':     '切换',

    // ── Chat origin labels ────────────────────────────────────────────────────
    'chat.origin.agent':             'Agent',
    'chat.origin.system':            '系统',
    'chat.ephemeral':                '不计入上下文',

} as const;

// LocaleStrings maps every key to string (not literal), so other locales can provide different values.
export type LocaleStrings = { [K in keyof typeof zhCN]: string };
export type LocaleKey = keyof typeof zhCN;
