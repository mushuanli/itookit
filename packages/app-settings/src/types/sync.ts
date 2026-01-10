// @file: app-settings/types/sync.ts

import { SyncProgress } from '@itookit/vfs';

// ==================== 核心配置 ====================

export type SyncStrategyType = 'manual' | 'bidirectional' | 'push' | 'pull';
export type TransportType = 'auto' | 'websocket' | 'http';
export type ConflictResolutionType = 'server-wins' | 'client-wins' | 'newer-wins' | 'manual';

/**
 * [重命名] AppSyncSettings
 * 用户在设置面板中填写的配置，存储在 /__config/sync_config.json 中
 */
export interface AppSyncSettings {
    // 服务器连接
    serverUrl: string;
    username: string;
    token?: string; // JWT 或 API Key

    // 策略配置
    strategy: SyncStrategyType;
    conflictResolution: ConflictResolutionType;
    
    // 自动化
    autoSync: boolean;
    autoSyncInterval: number; // 分钟

    // 传输与网络
    transport: TransportType;
    
    // 过滤选项
    filters?: {
        excludeBinary?: boolean;
        maxFileSize?: number; // bytes
        excludePaths?: string[];
        includePaths?: string[];
    };
}

// ==================== UI 状态 ====================

export type UISyncState = 'idle' | 'connecting' | 'syncing' | 'paused' | 'error' | 'success' | 'offline';

/**
 * [重命名] AppSyncStatus
 * 供 UI 组件消费的综合状态对象
 */
export interface AppSyncStatus {
    state: UISyncState;
    lastSyncTime: number | null;
    
    // 连接详情
    connection?: {
        type: 'websocket' | 'http';
        connected: boolean;
        latency?: number;
    };

    // 进度信息 (直接复用 VFS 类型)
    progress?: SyncProgress;

    // 错误信息
    errorMessage?: string;
}

// ==================== 事件与日志 ====================

/**
 * [重命名] SystemLogEntry
 * UI 展示用的运行日志，区别于文件同步日志(SyncLog)
 */
export interface SystemLogEntry {
    timestamp: number;
    level: 'info' | 'success' | 'warn' | 'error';
    message: string;
    details?: Record<string, unknown>;
}

export type SyncMode = 'standard' | 'force_push' | 'force_pull';

// 定义 UI 事件
export interface SyncUIEvent {
    type: 'stateChange' | 'log' | 'conflict' | 'connected' | 'disconnected' | 'error' | 'completed' | 'progress';
    data?: any;
    timestamp: number;
}

export type SyncUIEventHandler = (event: SyncUIEvent) => void;