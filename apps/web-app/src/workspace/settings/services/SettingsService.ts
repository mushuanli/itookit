/**
 * @file: app/workspace/settings/services/SettingsService.ts
 */
import { LLM_DEFAULT_ID } from '@itookit/common';
import { VFSCore, VFSErrorCode, VFSEventType, VFSEvent } from '@itookit/vfs-core';
import { SettingsState, LLMConnection, MCPServer, Contact, Tag } from '../types';
import {
  LLM_PROVIDER_DEFAULTS,
  LLM_AGENT_TARGET_DIR,
  LLM_DEFAULT_AGENTS,
  LLM_DEFAULT_CONFIG_VERSION,
} from '../constants';

const CONFIG_MODULE = '__config';
const AGENT_MODULE = 'agents';
const VERSION_FILE_PATH = '/.defaults_version.json';

// 目录常量
const CONNECTIONS_DIR = '/connections';
const MCP_SERVERS_DIR = '/mcp_servers';

// 定义不向用户展示的系统内部模块
const SYSTEM_MODULES = ['__config', '__vfs_meta__', 'settings_ui'];
const SNAPSHOT_PREFIX = 'snapshot_';

const FILES = {
  tags: '/tags.json',
  contacts: '/contacts.json',
};

// 快照接口
export interface LocalSnapshot {
  name: string;
  displayName: string;
  timestamp: number;
}

type ChangeListener = () => void;

export class SettingsService {
  private vfs: VFSCore;
  private state: SettingsState = {
    connections: [],
    mcpServers: [],
    tags: [],
    contacts: [],
  };
  private listeners: Set<ChangeListener> = new Set();
  private initialized = false;
  private syncTimer: any = null;

  constructor(vfs: VFSCore) {
    this.vfs = vfs;
  }

  /**
   * 初始化：挂载模块并加载所有数据
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.vfs.getModule(CONFIG_MODULE)) {
      try {
        await this.vfs.mount(CONFIG_MODULE, 'Settings Persistence');
      } catch (e: any) {
        if (e.code !== VFSErrorCode.ALREADY_EXISTS) throw e;
      }
    }

    // 确保目录存在
    await this.ensureDirectories();

    await Promise.all([
      this.loadConnections(),
      this.loadMCPServers(),
      this.loadEntity('contacts'),
      this.syncTags(),
    ]);

    // 启动 VFS 事件监听，确保标签计数等实时同步
    this.bindVFSEvents();
    await this.ensureDefaults();
    this.initialized = true;
    this.notify();
  }

  /**
   * 确保必要的目录存在
   */
  private async ensureDirectories() {
    const dirs = [CONNECTIONS_DIR, MCP_SERVERS_DIR];
    for (const dir of dirs) {
      try {
        await this.vfs.createDirectory(CONFIG_MODULE, dir);
      } catch (e: any) {
        if (e.code !== VFSErrorCode.ALREADY_EXISTS) {
          console.warn(`Failed to create directory ${dir}:`, e);
        }
      }
    }
  }

  /**
   * 监听 VFS 事件以保持 Tag 计数同步
   */
  private bindVFSEvents() {
    const bus = this.vfs.getEventBus();

    // 监听这一组可能影响标签计数的事件
    const eventsToWatch = [
      VFSEventType.NODE_CREATED,
      VFSEventType.NODE_DELETED,
      VFSEventType.NODE_UPDATED,
      VFSEventType.NODES_BATCH_UPDATED,
    ];

    const handler = (event: VFSEvent) => {
      // 过滤掉配置模块自身的变更，防止 syncTags -> saveEntity -> node_updated -> syncTags 的死循环
      if (event.path && event.path.startsWith(`/${CONFIG_MODULE}`)) {
        return;
      }

      // 简单的防抖逻辑，避免频繁 IO
      if (this.syncTimer) clearTimeout(this.syncTimer);

      this.syncTimer = setTimeout(() => {
        // 重新同步标签并通知 UI 更新
        this.syncTags().then(() => this.notify());
      }, 1000);
    };

    // 订阅事件总线
    eventsToWatch.forEach((type) => {
      bus.on(type, handler);
    });
  }

  // --- Connections 目录存储 ---

  /**
   * 加载所有连接（从目录读取所有 JSON 文件）
   */
  private async loadConnections() {
    try {
      // [修复] 使用 VFSCore 的 getTree 方法替代不存在的 readDirectory
      const tree = await this.vfs.getTree(CONFIG_MODULE, CONNECTIONS_DIR);
      const connections: LLMConnection[] = [];

      for (const node of tree) {
        if (node.type === 'file' && node.path.endsWith('.json')) {
          try {
            const content = await this.vfs.read(CONFIG_MODULE, node.path);
            const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
            const conn = JSON.parse(jsonStr);
            
            // ✅ 修复：确保 availableModels 存在
            if (!conn.availableModels || conn.availableModels.length === 0) {
              const providerDef = LLM_PROVIDER_DEFAULTS[conn.provider];
              if (providerDef) {
                conn.availableModels = [...providerDef.models];
              }
            }
            
            connections.push(conn);
          } catch (e) {
            console.error(`Failed to load connection from ${node.path}:`, e);
          }
        }
      }

      this.state.connections = connections;
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        this.state.connections = [];
      } else {
        console.error('Failed to load connections:', e);
      }
    }
  }

  /**
   * 保存单个连接
   */
  async saveConnection(conn: LLMConnection) {
    const path = `${CONNECTIONS_DIR}/${conn.id}.json`;
    const content = JSON.stringify(conn, null, 2);

    try {
      await this.vfs.write(CONFIG_MODULE, path, content);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        await this.vfs.createFile(CONFIG_MODULE, path, content);
      } else {
        throw e;
      }
    }

    // 更新内存状态
    const idx = this.state.connections.findIndex(c => c.id === conn.id);
    if (idx >= 0) {
      this.state.connections[idx] = conn;
    } else {
      this.state.connections.push(conn);
    }

    this.notify();
  }

  /**
   * 删除连接
   */
  async deleteConnection(id: string) {
    if (id === LLM_DEFAULT_ID) {
      throw new Error(`Cannot delete system default connection (${id}).`);
    }

    const path = `${CONNECTIONS_DIR}/${id}.json`;
    
    try {
      // [修复] delete 方法接收 string，而不是 string[]
      await this.vfs.delete(CONFIG_MODULE, path);
    } catch (e) {
      console.error(`Failed to delete connection ${id}:`, e);
    }

    this.state.connections = this.state.connections.filter(c => c.id !== id);
    this.notify();
  }

  // --- MCP Servers 目录存储 ---

  /**
   * 加载所有 MCP 服务器
   */
  private async loadMCPServers() {
    try {
      // [修复] 使用 VFSCore 的 getTree 方法替代不存在的 readDirectory
      const tree = await this.vfs.getTree(CONFIG_MODULE, MCP_SERVERS_DIR);
      const servers: MCPServer[] = [];

      for (const node of tree) {
        if (node.type === 'file' && node.path.endsWith('.json')) {
          try {
            const content = await this.vfs.read(CONFIG_MODULE, node.path);
            const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
            servers.push(JSON.parse(jsonStr));
          } catch (e) {
            console.error(`Failed to load MCP server from ${node.path}:`, e);
          }
        }
      }

      this.state.mcpServers = servers;
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        this.state.mcpServers = [];
      } else {
        console.error('Failed to load MCP servers:', e);
      }
    }
  }

  /**
   * 保存单个 MCP 服务器
   */
  async saveMCPServer(server: MCPServer) {
    const path = `${MCP_SERVERS_DIR}/${server.id}.json`;
    const content = JSON.stringify(server, null, 2);

    try {
      await this.vfs.write(CONFIG_MODULE, path, content);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        await this.vfs.createFile(CONFIG_MODULE, path, content);
      } else {
        throw e;
      }
    }

    const idx = this.state.mcpServers.findIndex(s => s.id === server.id);
    if (idx >= 0) {
      this.state.mcpServers[idx] = server;
    } else {
      this.state.mcpServers.push(server);
    }

    this.notify();
  }

  /**
   * 删除 MCP 服务器
   */
  async deleteMCPServer(id: string) {
    const path = `${MCP_SERVERS_DIR}/${id}.json`;
    
    try {
      // [修复] delete 方法接收 string，而不是 string[]
      await this.vfs.delete(CONFIG_MODULE, path);
    } catch (e) {
      console.error(`Failed to delete MCP server ${id}:`, e);
    }

    this.state.mcpServers = this.state.mcpServers.filter(s => s.id !== id);
    this.notify();
  }

  // --- 单文件实体通用方法 ---

  private async loadEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K) {
    const path = FILES[key];
    try {
      const content = await this.vfs.read(CONFIG_MODULE, path);
      const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
      this.state[key] = JSON.parse(jsonStr);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        this.state[key] = [];
      } else {
        console.error(`Failed to load ${key}`, e);
      }
    }
  }

  private async saveEntity<K extends keyof Pick<SettingsState, 'tags' | 'contacts'>>(key: K) {
    const path = FILES[key];
    const content = JSON.stringify(this.state[key], null, 2);
    try {
      await this.vfs.write(CONFIG_MODULE, path, content);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        await this.vfs.createFile(CONFIG_MODULE, path, content);
      } else {
        throw e;
      }
    }
    if (key !== 'tags') this.notify();
  }

  // =========================================================
  // 版本控制辅助方法
  // =========================================================

  private async _shouldSkipDefaultsSync(): Promise<boolean> {
    try {
      const content = await this.vfs.read(CONFIG_MODULE, VERSION_FILE_PATH);
      const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
      const data = JSON.parse(jsonStr);

      if (data.version >= LLM_DEFAULT_CONFIG_VERSION) {
        return true;
      }
    } catch (e: any) {
      if (e.code !== VFSErrorCode.NOT_FOUND) {
        console.warn('[SettingsService] Failed to check config version, forcing sync:', e);
      }
    }
    return false;
  }

  private async _updateConfigVersion(): Promise<void> {
    const content = JSON.stringify(
      {
        version: LLM_DEFAULT_CONFIG_VERSION,
        updatedAt: Date.now(),
      },
      null,
      2
    );

    try {
      await this.vfs.write(CONFIG_MODULE, VERSION_FILE_PATH, content);
    } catch (e: any) {
      if (e.code === VFSErrorCode.NOT_FOUND) {
        await this.vfs.createFile(CONFIG_MODULE, VERSION_FILE_PATH, content);
      }
    }
  }

  // =========================================================================
  // 目录与文件辅助方法
  // =========================================================================

  private async _ensureDirectoryHierarchy(moduleName: string, fullPath: string): Promise<void> {
    const parts = fullPath.split('/').filter((p) => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath += `/${part}`;
      try {
        await this.vfs.createDirectory(moduleName, currentPath);
      } catch (e: any) {
        if (
          e.code !== VFSErrorCode.ALREADY_EXISTS &&
          (!e.message || e.message.indexOf('exists') === -1)
        ) {
          console.warn(`[SettingsService] Warning creating directory ${currentPath}:`, e);
        }
      }
    }
  }

  /**
   * 同步 LLM 连接和模型配置
   * 注意：此方法现在只负责 Connections 的同步，不再负责创建 Agent
   */
  private async _syncLLMProvidersWithDefaults(): Promise<void> {
    const existingConnections = this.state.connections;
    const defaultProviders = LLM_PROVIDER_DEFAULTS;
    const updatedConnections: LLMConnection[] = [];
    const processedProviderKeys = new Set<string>();

    for (const [providerKey, providerDef] of Object.entries(defaultProviders)) {
      processedProviderKeys.add(providerKey);

      const existingConnectionsForProvider = existingConnections.filter(
        (conn) => conn.provider === providerKey
      );

      if (existingConnectionsForProvider.length === 0) {
        // 1. 新的 Provider: 创建默认连接
        const defaultConnId =
          providerKey === 'rdsec' ? LLM_DEFAULT_ID : `conn-${providerKey}`;

        const newConnection: LLMConnection = {
          id: defaultConnId,
          name: providerDef.name,
          provider: providerKey,
          apiKey: '', // 用户需要填写
          baseURL: providerDef.baseURL,
          model: providerDef.models[0]?.id || '',
          availableModels: [...providerDef.models],
          metadata: {
            ...providerDef,
            isSystemDefault: true,
          },
        };
        updatedConnections.push(newConnection);
        
      } else {
        // 2. 已有的 Provider: 检查并更新模型列表
        for (const existingConn of existingConnectionsForProvider) {
          const updatedConn = { ...existingConn };
          let hasUpdates = false;

          // ✅ 修复：如果 availableModels 为空，从默认值初始化
          if (!updatedConn.availableModels || updatedConn.availableModels.length === 0) {
            updatedConn.availableModels = [...providerDef.models];
            hasUpdates = true;
          }

          // 检查 BaseURL
          if (existingConn.baseURL !== providerDef.baseURL && !existingConn.baseURL) {
            updatedConn.baseURL = providerDef.baseURL;
            hasUpdates = true;
          }

          // 检查模型列表
          const existingModelIds = new Set(existingConn.availableModels?.map((m) => m.id) || []);
          const defaultModelIds = new Set(providerDef.models.map((m) => m.id));

          // 检测新增
          for (const defaultModel of providerDef.models) {
            if (!existingModelIds.has(defaultModel.id)) {
              if (!updatedConn.availableModels) {
                updatedConn.availableModels = [];
              }
              updatedConn.availableModels.push({ ...defaultModel });
              hasUpdates = true;
            }
          }

          // 检测更新 (Name)
          for (const existingModel of existingConn.availableModels || []) {
            const defaultModel = providerDef.models.find((m) => m.id === existingModel.id);
            if (defaultModel && defaultModel.name !== existingModel.name) {
              existingModel.name = defaultModel.name;
              hasUpdates = true;
            }
          }

          // 检查当前模型有效性
          if (existingConn.model && !defaultModelIds.has(existingConn.model)) {
            updatedConn.model = providerDef.models[0]?.id || '';
            hasUpdates = true;
          }

          // 元数据更新
          if (!updatedConn.metadata || !updatedConn.metadata.isSystemDefault) {
            updatedConn.metadata = {
              ...(updatedConn.metadata || {}),
              ...providerDef,
              isSystemDefault: true,
              lastSynced: Date.now(),
            };
            hasUpdates = true;
          }

          updatedConnections.push(hasUpdates ? updatedConn : existingConn);
        }
      }
    }

    // 保留用户自定义的非预设 Provider 连接
    for (const existingConn of existingConnections) {
      if (!processedProviderKeys.has(existingConn.provider)) {
        updatedConnections.push(existingConn);
      }
    }

    // 更新状态并保存
    if (JSON.stringify(this.state.connections) !== JSON.stringify(updatedConnections)) {
      console.log('[SettingsService] LLM connections updated');
      for (const conn of updatedConnections) {
        await this.saveConnection(conn);
      }
    }
  }

  /**
   * 初始化核心流程
   * 策略：
   * 1. 优先使用 LLM_DEFAULT_AGENTS 定义的定制化 Agent (Custom)。
   * 2. 如果 Connection 没有对应的 Custom Agent，则自动生成一个通用 Agent (Auto)。
   */
  private async ensureDefaults(): Promise<void> {
    // 1. 检查版本
    const shouldSkip = await this._shouldSkipDefaultsSync();
    if (shouldSkip) {
      console.log(`[SettingsService] Skip defaults sync (v${LLM_DEFAULT_CONFIG_VERSION})`);
      return;
    }

    console.log(`[SettingsService] Syncing defaults (v${LLM_DEFAULT_CONFIG_VERSION})...`);

    // 2. 同步 Connections (确保数据库里有最新的 Connection 列表)
    await this._syncLLMProvidersWithDefaults();

    if (this.vfs.getModule(AGENT_MODULE)) {
      const coveredConnectionIds = new Set<string>();

      // 处理定制化 Agents
      for (const agentDef of LLM_DEFAULT_AGENTS) {
        if (agentDef.config && agentDef.config.connectionId) {
          coveredConnectionIds.add(agentDef.config.connectionId);
        }

        const fileName = `${agentDef.id}.agent`;
        const dirPath = agentDef.initPath || '';
        const fullPath = `${dirPath}/${fileName}`.replace(/\/+/g, '/');

        const fileId = await this.vfs.getVFS().pathResolver.resolve(AGENT_MODULE, fullPath);

        if (!fileId) {
          const { initialTags, initPath, ...contentData } = agentDef;
          const content = JSON.stringify(contentData, null, 2);

          if (dirPath && dirPath !== '/') {
            await this._ensureDirectoryHierarchy(AGENT_MODULE, dirPath);
          }

          try {
            const node = await this.vfs.createFile(AGENT_MODULE, fullPath, content, {
              isProtected: true,
              isSystem: true,
              version: 1,
            });

            if (initialTags && initialTags.length > 0) {
              await this.vfs.setNodeTagsById(node.nodeId, initialTags);
            }
            console.log(`[SettingsService] Created custom agent: ${fullPath}`);
          } catch (e) {
            console.error(`[SettingsService] Failed to create custom agent ${fullPath}`, e);
          }
        }
      }

      // 为剩余连接自动生成 Agent
      const allConnections = this.getConnections();

      for (const conn of allConnections) {
        if (coveredConnectionIds.has(conn.id) || conn.id === LLM_DEFAULT_ID) {
          continue;
        }
        await this._ensureDefaultAgentForConnection(conn);
      }
    }

    await this._updateConfigVersion();
  }

  /**
   * 为特定连接自动生成 Agent
   */
  private async _ensureDefaultAgentForConnection(conn: LLMConnection): Promise<void> {
    // 构造文件名：使用 Provider Key 作为基础。
    // 如果存在多个相同 Provider 的 Connection，可能会重名冲突，
    // 这里简化处理，假设每个 Provider 只生成一个默认 Agent。
    const safeName = conn.provider.replace(/[^a-zA-Z0-9-]/g, '_');
    const fileName = `${safeName}.agent`;
    const fullPath = `${LLM_AGENT_TARGET_DIR}/${fileName}`;

    // 再次检查文件是否存在 (防止 VFS 层面冲突)
    const fileId = await this.vfs.getVFS().pathResolver.resolve(AGENT_MODULE, fullPath);
    if (fileId) return;

    // 准备内容
    const firstModelId = conn.availableModels?.[0]?.id || conn.model || '';
    const agentName = `${conn.name} 助手`; // e.g. "OpenAI 助手"
    const agentIcon = this._getProviderIcon(conn.provider);

    const agentContent = {
      id: `agent-auto-${conn.id}`,
      name: agentName,
      type: 'agent',
      description: `基于 ${conn.name} 的自动生成助手`,
      icon: agentIcon,
      config: {
        connectionId: conn.id,
        modelId: firstModelId,
        systemPrompt: `You are a helpful assistant powered by ${conn.name}.`,
        maxHistoryLength: -1,
      },
      interface: {
        inputs: [{ name: 'prompt', type: 'string' }],
        outputs: [{ name: 'response', type: 'string' }],
      },
    };

    const content = JSON.stringify(agentContent, null, 2);

    try {
      await this._ensureDirectoryHierarchy(AGENT_MODULE, LLM_AGENT_TARGET_DIR);

      const node = await this.vfs.createFile(AGENT_MODULE, fullPath, content, {
        isProtected: false,
        isSystem: false,
        version: 1,
      });

      if (node && node.nodeId) {
        await this.vfs.setNodeTagsById(node.nodeId, ['auto-generated', conn.provider]);
      }
      console.log(`[SettingsService] Auto-generated agent: ${fullPath}`);
    } catch (error) {
      console.error(`[SettingsService] Failed to auto-generate agent:`, error);
    }
  }

  /**
   * 获取 Provider 对应的图标
   */
  private _getProviderIcon(providerKey: string): string {
    const iconMap: Record<string, string> = {
      openai: '🤖',
      rdsec: '🔐',
      anthropic: '📚',
      gemini: '💎',
      deepseek: '🌊',
      openrouter: '🔀',
      cloudapi: '☁️',
      custom_openai_compatible: '⚙️',
    };

    return iconMap[providerKey] || '🤖';
  }

  // --- CRUD Operations ---

  // Connections
  getConnections() {
    return [...this.state.connections];
  }

  getConnection(id: string): LLMConnection | undefined {
    return this.state.connections.find((c) => c.id === id);
  }

  getMCPServers() {
    return [...this.state.mcpServers];
  }

  // Contacts
  getContacts() {
    return [...this.state.contacts];
  }
  async saveContact(contact: Contact) {
    this.updateOrAdd(this.state.contacts, contact);
    await this.saveEntity('contacts');
  }
  async deleteContact(id: string) {
    this.state.contacts = this.state.contacts.filter((c) => c.id !== id);
    await this.saveEntity('contacts');
    this.notify();
  }

  // Tags
  getTags() {
    return [...this.state.tags];
  }

  /**
   * 同步标签数据
   * 公开此方法，允许 Editor 获得焦点时强制刷新
   */
  public async syncTags() {
    try {
      let configTags: Tag[] = [];
      try {
        const content = await this.vfs.read(CONFIG_MODULE, FILES.tags);
        const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
        configTags = JSON.parse(jsonStr);
      } catch (e) {
        /* ignore */
      }

      const vfsTags = await this.vfs.getAllTags();

      const mergedTags: Tag[] = vfsTags.map((vTag) => {
        const configTag = configTags.find((ct) => ct.name === vTag.name);
        return {
          id: vTag.name,
          name: vTag.name,
          color: vTag.color || configTag?.color || '#3b82f6',
          description: configTag?.description || '',
          count: vTag.refCount || 0,
        };
      });

      const oldStateStr = JSON.stringify(this.state.tags);
      this.state.tags = mergedTags;
      const newStateStr = JSON.stringify(this.state.tags);

      this.saveEntity('tags').catch((err) => console.error('Failed to save merged tags', err));

      if (oldStateStr !== newStateStr && this.initialized) {
        this.notify();
      }
    } catch (e) {
      console.error('[SettingsService] Failed to sync tags:', e);
    }
  }

  async saveTag(tag: Tag) {
    await this.vfs.updateTag(tag.name, { color: tag.color });
    this.updateOrAdd(this.state.tags, tag);
    await this.saveEntity('tags');
  }

  async deleteTag(tagId: string) {
    const tag = this.state.tags.find((t) => t.id === tagId);
    if (!tag) return;
    await this.vfs.deleteTagDefinition(tag.name);
    this.state.tags = this.state.tags.filter((t) => t.id !== tagId);
    await this.saveEntity('tags');
    this.notify();
  }

  // --- Export/Import Logic ---

  /**
   * 混合导出：支持配置项 + VFS 模块
   */
  async exportMixedData(settingsKeys: (keyof SettingsState)[], moduleNames: string[]): Promise<any> {
    const exportData: any = {
      version: 2,
      timestamp: Date.now(),
      type: 'mixed_backup',
      settings: {},
      modules: [],
    };

    // 导出 connections 和 mcpServers（目录方式）
    if (settingsKeys.includes('connections')) {
      exportData.settings.connections = this.state.connections;
    }
    if (settingsKeys.includes('mcpServers')) {
      exportData.settings.mcpServers = this.state.mcpServers;
    }
    if (settingsKeys.includes('tags')) {
      exportData.settings.tags = this.state.tags;
    }
    if (settingsKeys.includes('contacts')) {
      exportData.settings.contacts = this.state.contacts;
    }

    for (const name of moduleNames) {
      try {
        const moduleDump = await this.vfs.exportModule(name);
        exportData.modules.push(moduleDump);
      } catch (e) {
        console.warn(`Failed to export module ${name}`, e);
      }
    }
    return exportData;
  }

  /**
   * 混合导入
   */
  async importMixedData(
    data: any,
    settingsKeys: (keyof SettingsState)[],
    moduleNames: string[]
  ) {
    const tasks: Promise<void>[] = [];
    
    if (data.settings) {
      // 处理 connections
      if (settingsKeys.includes('connections') && data.settings.connections) {
        for (const conn of data.settings.connections) {
          tasks.push(this.saveConnection(conn));
        }
      }
      
      // 处理 mcpServers
      if (settingsKeys.includes('mcpServers') && data.settings.mcpServers) {
        for (const server of data.settings.mcpServers) {
          tasks.push(this.saveMCPServer(server));
        }
      }
      
      // 处理单文件实体
      if (settingsKeys.includes('tags') && data.settings.tags) {
        this.state.tags = data.settings.tags;
        tasks.push(this.saveEntity('tags'));
      }
      if (settingsKeys.includes('contacts') && data.settings.contacts) {
        this.state.contacts = data.settings.contacts;
        tasks.push(this.saveEntity('contacts'));
      }
    }

    const modulesList = data.modules || [];
    if (Array.isArray(modulesList)) {
      for (const modDump of modulesList) {
        const modName = modDump.module?.name;
        if (modName && moduleNames.includes(modName)) {
          try {
            if (this.vfs.getModule(modName)) {
              await this.vfs.unmount(modName);
            }
            await this.vfs.importModule(modDump);
          } catch (e) {
            console.error(`Failed to import module ${modName}`, e);
          }
        }
      }
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    await this.syncTags();
    this.notify();
  }

  // --- 本地快照管理 ---

  async listLocalSnapshots(): Promise<LocalSnapshot[]> {
    if (!window.indexedDB.databases) {
      return [];
    }
    const dbs = await window.indexedDB.databases();
    const snapshots: LocalSnapshot[] = [];
    for (const db of dbs) {
      if (db.name && db.name.startsWith(SNAPSHOT_PREFIX)) {
        const parts = db.name.split('_');
        const timestamp = parseInt(parts[1]);
        if (!isNaN(timestamp)) {
          snapshots.push({
            name: db.name,
            displayName: new Date(timestamp).toLocaleString(),
            timestamp,
          });
        }
      }
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  async createSnapshot(): Promise<void> {
    const currentDbName = this.vfs.dbName;
    const timestamp = Date.now();
    const targetDbName = `${SNAPSHOT_PREFIX}${timestamp}`;
    await VFSCore.copyDatabase(currentDbName, targetDbName);
  }

  async restoreSnapshot(snapshotName: string): Promise<void> {
    const currentDbName = this.vfs.dbName;
    await this.vfs.shutdown();
    await VFSCore.copyDatabase(snapshotName, currentDbName);
  }

  async deleteSnapshot(snapshotName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.deleteDatabase(snapshotName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn(`Delete ${snapshotName} blocked`);
    });
  }

  // --- System Actions ---

  async createFullBackup(): Promise<string> {
    return this.vfs.createSystemBackup();
  }

  async restoreFullBackup(jsonContent: string): Promise<void> {
    await this.vfs.restoreSystemBackup(jsonContent);
    this.initialized = false;
    await this.init();
  }

  async factoryReset(): Promise<void> {
    await this.vfs.systemReset();
  }

  // --- Reactivity ---

  private updateOrAdd<T extends { id: string }>(list: T[], item: T) {
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    this.notify();
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // 辅助: 获取可导出数据的 Keys
  getAvailableSettingsKeys(): (keyof SettingsState)[] {
    return ['connections', 'mcpServers', 'tags', 'contacts'];
  }

  // 辅助: 获取所有用户工作区
  getAvailableWorkspaces() {
    return this.vfs
      .getAllModules()
      .filter((m) => !SYSTEM_MODULES.includes(m.name))
      .map((m) => ({ name: m.name, description: m.description }));
  }
}
