// common/interfaces/fs/ISeqFile.ts
/**
 * @file common/interfaces/fs/ISeqFile.ts
 * @desc SeqFile（键值对文件）操作接口
 *
 * SeqFile 是一种简单的键值文件格式，每行为 key=value。
 * 当文件系统建立在 DB 上时，可将每个条目映射为一行记录，
 * 实现 O(1) 的单字段读写，而非每次读写整个文件。
 *
 * 典型用途:
 * - 配置文件（app.conf, theme.conf）
 * - SRS 卡片状态数据
 * - 用户偏好设置
 */

/**
 * SeqFile 条目
 */
export interface SeqFileEntry {
    /** 键 */
    key: string;

    /** 值（始终为字符串存储，消费方自行转换类型） */
    value: string;

    /**
     * 值的类型提示（可选，用于反序列化）
     * 存储时仍以字符串形式保存，此字段仅作为消费方的解析提示
     */
    valueType?: 'string' | 'number' | 'boolean' | 'json';
}

/**
 * SeqFile 操作接口
 *
 * 通过 IModuleFS.seq 访问（当 capabilities.seqFiles === true）。
 * 当 seqfile 能力不可用时，消费方应降级为：
 *   readContent() → 文本解析 → writeContent()
 */
export interface ISeqFileOperations {
    /**
     * 读取单个键的值
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param key - 键名
     * @returns 值字符串，键不存在返回 null
     */
    getEntry(fileIdOrPath: string, key: string): Promise<string | null>;

    /**
     * 读取多个键的值
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param keys - 键名列表
     * @returns 键值映射（不存在的键不包含在结果中）
     */
    getEntries(
        fileIdOrPath: string,
        keys: string[]
    ): Promise<Record<string, string>>;

    /**
     * 读取所有键值对
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @returns 所有条目列表
     */
    getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]>;

    /**
     * 设置单个键（不存在则创建，存在则覆盖）
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param key - 键名
     * @param value - 值
     */
    setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;

    /**
     * 批量设置键值对（合并模式，不影响未提及的键）
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param entries - 键值映射
     */
    setEntries(
        fileIdOrPath: string,
        entries: Record<string, string>
    ): Promise<void>;

    /**
     * 删除单个键
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param key - 键名
     */
    deleteEntry(fileIdOrPath: string, key: string): Promise<void>;

    /**
     * 检查键是否存在
     * @param fileIdOrPath - seqfile 节点的 ID 或路径
     * @param key - 键名
     */
    hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;
}
