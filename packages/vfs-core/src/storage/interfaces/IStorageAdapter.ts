// @file vfs/storage/interfaces/IStorageAdapter.ts

/**
 * 存储适配器接口
 * 所有数据库实现必须遵循此接口
 */
export interface IStorageAdapter {
  /** 适配器名称 */
  readonly name: string;
  
  /** 连接状态 */
  readonly isConnected: boolean;

  // ==================== 生命周期 ====================
  
  /**
   * 连接到数据库
   */
  connect(): Promise<void>;
  
  /**
   * 断开连接
   */
  disconnect(): Promise<void>;
  
  /**
   * 销毁数据库（删除所有数据）
   */
  destroy(): Promise<void>;

  // ==================== 事务管理 ====================
  
  /**
   * 开始事务
   * @param stores 涉及的集合名称
   * @param mode 事务模式
   */
  beginTransaction(stores: string[], mode: 'readonly' | 'readwrite'): ITransaction;
  
  // ==================== 集合操作 ====================
  
  /**
   * 获取集合操作句柄（非事务模式）
   * @param name 集合名称
   */
  getCollection<T>(name: string): ICollection<T>;
}

/**
 * 事务接口
 */
export interface ITransaction {
  /**
   * 获取事务内集合操作句柄
   * @param name 集合名称
   */
  getCollection<T>(name: string): ICollectionInTransaction<T>;
  
  /**
   * 提交事务
   */
  commit(): Promise<void>;
  
  /**
   * 回滚事务
   */
  abort(): Promise<void>;
  
  /**
   * 事务完成 Promise（兼容旧代码）
   */
  readonly done: Promise<void>;
}

/**
 * 集合操作接口（非事务模式）
 */
export interface ICollection<T> {
  /** 集合名称 */
  readonly name: string;

  // ==================== 基础 CRUD ====================
  
  /**
   * 根据主键获取单条记录
   */
  get(key: unknown): Promise<T | undefined>;
  
  /**
   * 获取所有记录
   */
  getAll(): Promise<T[]>;
  
  /**
   * 插入或更新记录
   */
  put(value: T): Promise<void>;
  
  /**
   * 根据主键删除记录
   */
  delete(key: unknown): Promise<void>;
  
  /**
   * 清空集合
   */
  clear(): Promise<void>;
  
  /**
   * 获取记录数量
   */
  count(): Promise<number>;

  // ==================== 索引查询 ====================
  
  /**
   * 根据索引获取单条记录
   */
  getByIndex(indexName: string, value: unknown): Promise<T | undefined>;
  
  /**
   * 根据索引获取所有匹配记录
   */
  getAllByIndex(indexName: string, value: unknown): Promise<T[]>;
  
  // ==================== 高级查询 ====================
  
  /**
   * 复合条件查询
   */
  query(options: QueryOptions): Promise<T[]>;
}

/**
 * 事务内集合操作接口
 * 继承基础集合接口，增加批量操作
 */
export interface ICollectionInTransaction<T> extends ICollection<T> {
  /**
   * 批量插入或更新
   */
  bulkPut(values: T[]): Promise<void>;
  
  /**
   * 批量删除
   */
  bulkDelete(keys: unknown[]): Promise<void>;
}

/**
 * 查询选项
 */
export interface QueryOptions {
  /** 使用的索引名称 */
  index?: string;
  
  /** 范围条件 */
  range?: {
    lower?: unknown;
    upper?: unknown;
    lowerOpen?: boolean;
    upperOpen?: boolean;
  };
  
  /** 排序方向 */
  direction?: 'next' | 'prev';
  
  /** 限制返回数量 */
  limit?: number;
  
  /** 跳过前 N 条 */
  offset?: number;
  
  /** 内存过滤函数 */
  filter?: (item: unknown) => boolean;
}

/**
 * 集合 Schema 定义
 */
export interface CollectionSchema {
  /** 集合名称 */
  name: string;
  
  /** 主键路径（单字段或复合键） */
  keyPath: string | string[];
  
  /** 是否自增主键 */
  autoIncrement?: boolean;
  
  /** 索引定义列表 */
  indexes: IndexSchema[];
}

/**
 * 索引 Schema 定义
 */
export interface IndexSchema {
  /** 索引名称 */
  name: string;
  
  /** 索引字段路径 */
  keyPath: string | string[];
  
  /** 是否唯一索引 */
  unique?: boolean;
  
  /** 是否多值索引（数组字段） */
  multiEntry?: boolean;
}
