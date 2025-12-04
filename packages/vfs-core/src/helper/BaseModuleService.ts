/**
 * @file: vfs-core/helper/BaseModuleService.ts
 * @description 基础应用服务，封装 VFS 挂载、JSON 读写和事件通知。
 */
import {VFSErrorCode} from '../core/types';
import { VFSCore,MountOptions } from '../VFSCore';
import { VFSModuleEngine } from './VFSModuleEngine';

export type ChangeListener = () => void;

export abstract class BaseModuleService {
    protected vfs: VFSCore;
    public readonly moduleEngine: VFSModuleEngine; 
    
    protected initialized = false;

    protected listeners: Set<ChangeListener> = new Set();

    constructor(
        protected moduleName: string,
        protected mountOptions: MountOptions = { description: 'App Workspace' },
        vfs?: VFSCore
    ) {
        this.vfs = vfs || VFSCore.getInstance();
        this.moduleEngine = new VFSModuleEngine(moduleName, this.vfs);
    }

    /**
     * 模板方法：初始化流程
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await this.moduleEngine.init();
        // 2. 子类加载逻辑
        await this.onLoad();

        this.initialized = true;
        this.notify();
    }

    /**
     * 子类需实现的加载逻辑
     */
    protected abstract onLoad(): Promise<void>;

    /**
     * 辅助：读取 JSON 文件 (如果不存在返回 null)
     */
    protected async readJson<T>(path: string): Promise<T | null> {
        try {
            const content = await this.vfs.read(this.moduleName, path);
            const jsonStr = typeof content === 'string' ? content : new TextDecoder().decode(content);
            return JSON.parse(jsonStr);
        } catch (e: any) {
            if (e.code !== VFSErrorCode.NOT_FOUND) {
                console.warn(`[${this.constructor.name}] Failed to read ${path}:`, e);
            }
            return null;
        }
    }

    /**
     * 辅助：写入 JSON 文件 (自动创建父目录逻辑需在 VFS 层或此处增强，这里简化)
     */
    protected async writeJson(path: string, data: any): Promise<void> {
        const content = JSON.stringify(data, null, 2);
        try {
            await this.vfs.write(this.moduleName, path, content);
        } catch (e: any) {
            if (e.code === VFSErrorCode.NOT_FOUND) {
                // 简单处理：尝试创建文件（VFS createDirectory 逻辑略，假设扁平或已存在）
                await this.vfs.createFile(this.moduleName, path, content);
            } else {
                throw e;
            }
        }
    }

    protected async deleteFile(path: string): Promise<void> {
        try {
            await this.vfs.delete(this.moduleName, path);
        } catch (e) {
            console.warn(`[${this.constructor.name}] Delete failed: ${path}`, e);
        }
    }

    /**
     * 订阅变更
     */
    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    protected notify() {
        this.listeners.forEach((l) => l());
    }
}
