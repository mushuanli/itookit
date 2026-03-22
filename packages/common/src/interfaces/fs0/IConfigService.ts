/**
 * @file common/interfaces/fs/IConfigService.ts
 * @desc 配置服务接口
 *
 * 从 IVFSManager 剥离，遵循 SRP。
 * 内部依赖 IVFSManager 的 __config 模块实现存储，
 * 但消费方不需要知道底层是 seqfile 还是 JSON（DIP）。
 *
 * 实现方：
 * - SeqFileConfigService：基于 __config 模块的 seqfile
 * - MemoryConfigService：纯内存（测试用）
 *
 * 消费方：
 * - SettingsService, ThemeService, SyncService
 */

export interface ConfigFileDescriptor {
    /** 配置文件名（如 'app', 'theme', 'sync'） */
    name: string;
    /** 描述 */
    description?: string;
    /** 是否只读 */
    readonly?: boolean;
}

export interface ConfigChangeEvent {
    configName: string;
    key: string;
    oldValue?: string;
    newValue?: string;
}

export interface IConfigService {
    /**
     * 获取所有配置文件列表
     */
    listConfigs(): Promise<ConfigFileDescriptor[]>;

    /**
     * 读取配置值
     * @returns 不存在返回 null
     */
    get(configName: string, key: string): Promise<string | null>;

    /**
     * 读取配置值（带默认值和类型转换）
     */
    getString(configName: string, key: string, defaultValue: string): Promise<string>;
    getNumber(configName: string, key: string, defaultValue: number): Promise<number>;
    getBoolean(configName: string, key: string, defaultValue: boolean): Promise<boolean>;
    getJson<T>(configName: string, key: string, defaultValue: T): Promise<T>;

    /**
     * 读取配置文件所有键值对
     */
    getAll(configName: string): Promise<Record<string, string>>;

    /**
     * 设置配置值（配置文件不存在则自动创建）
     * @emits config:changed
     */
    set(configName: string, key: string, value: string): Promise<void>;

    /**
     * 批量设置（合并模式）
     * @emits config:changed（每个变更键一次，但实现可合并为单次事务）
     */
    setBatch(
        configName: string,
        entries: Record<string, string>
    ): Promise<void>;

    /**
     * 删除配置键
     * @emits config:changed { newValue: undefined }
     */
    delete(configName: string, key: string): Promise<void>;

    /**
     * 订阅配置变更
     * @param configName - '*' 表示所有配置文件
     * @returns 取消订阅函数
     */
    onChange(
        configName: string,
        handler: (event: ConfigChangeEvent) => void
    ): () => void;
}
