// @vfs-driver/core/helper/assetdir.ts

import { PathUtils } from '../path';
import type { FSFacade } from './types';
import { FileSystemError } from '../errors';
import { FileType } from '../../interface/types';
import type { ExtendedMetadata } from '../../interface/types';

/**
 * AssetDir 工具类 - 管理文件的资产目录
 * 
 * 设计原则:
 * - 文件 a/b/c/d.ext 的 assetdir 是 a/b/c/.d.ext/
 * - 文件和 assetdir 通过 metadata 双向引用
 * - assetdir 是可选的，按需创建
 * - 支持 Regular 和 Record 两种文件类型
 * - 对用户完全透明，自动同步
 */
export class AssetDirUtils {

  /** 支持 assetdir 的文件类型集合 */
  private static readonly SUPPORTED_TYPES = new Set([
    FileType.REGULAR,
    FileType.RECORD,
  ]);

  /** assetdir 内部元数据字段，不应被外部直接修改 */
  private static readonly PROTECTED_FIELDS: ReadonlySet<string> = new Set([
    'assetDirIno',
    'ownerFileIno',
    'isAssetDir',
  ]);

  // ============================================================
  // 纯计算方法（无副作用）
  // ============================================================

  /**
   * 判断文件类型是否支持 assetdir
   */
  static isSupportedType(type: FileType): boolean {
    return this.SUPPORTED_TYPES.has(type);
  }

  /**
   * 从文件名计算 assetdir 目录名
   * 
   * @example
   * getAssetDirName('d.ext') => '.d.ext'
   * getAssetDirName('readme') => '.readme'
   */
  static getAssetDirName(fileName: string): string {
    return `.${fileName}`;
  }

  /**
   * 计算文件的 assetdir 路径
   */
  static getAssetDirPath(filePath: string): string {
    const norm = PathUtils.normalize(filePath);
    const dir = PathUtils.dirname(norm);
    const base = PathUtils.basename(norm);
    return PathUtils.join(dir, this.getAssetDirName(base));
  }

  /**
   * 从 assetdir 名称反推文件名
   */
  static getFileNameFromAssetDirName(assetDirName: string): string {
    if (!assetDirName.startsWith('.') || assetDirName.length <= 1) {
      throw new FileSystemError('EINVAL', assetDirName, 'Not a valid assetdir name');
    }
    return assetDirName.slice(1);
  }

  /**
   * 从 assetdir 路径反推文件路径
   */
  static getFilePathFromAssetDir(assetDirPath: string): string {
    const norm = PathUtils.normalize(assetDirPath);
    const dir = PathUtils.dirname(norm);
    const base = PathUtils.basename(norm);
    return PathUtils.join(dir, this.getFileNameFromAssetDirName(base));
  }

  /**
   * 判断元数据字段是否为 assetdir 保护字段
   * 用于 setMetadata 校验
   */
  static isProtectedField(field: string): boolean {
    return this.PROTECTED_FIELDS.has(field);
  }

  /**
   * 清理元数据中的 assetdir 相关字段
   * 用于 copy 等场景，避免复制脏引用
   */
  static cleanMetadataForCopy(
    metadata: Partial<ExtendedMetadata>,
  ): Partial<ExtendedMetadata> {
    const cleaned = { ...metadata };
    delete cleaned.assetDirIno;
    delete cleaned.ownerFileIno;
    delete cleaned.isAssetDir;
    return cleaned;
  }

  // ============================================================
  // 查询方法
  // ============================================================

  /**
   * 检查文件是否有 assetdir
   */
  static async hasAssetDir(fs: FSFacade, filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      if (!this.isSupportedType(stat.type)) return false;
      if (!stat.metadata.assetDirIno) return false;

      const assetDirPath = this.getAssetDirPath(filePath);
      if (!await fs.exists(assetDirPath)) return false;

      const assetDirStat = await fs.stat(assetDirPath);
      return assetDirStat.type === FileType.DIRECTORY
        && assetDirStat.metadata.isAssetDir === true
        && assetDirStat.metadata.ownerFileIno === stat.ino;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件的 assetdir 路径
   */
  static async getAssetDir(fs: FSFacade, filePath: string): Promise<string | null> {
    return (await this.hasAssetDir(fs, filePath))
      ? this.getAssetDirPath(filePath)
      : null;
  }

  /**
   * 确保 assetdir 存在
   */
  static async ensureAssetDir(fs: FSFacade, filePath: string): Promise<string> {
    const norm = PathUtils.normalize(filePath);
    const fileStat = await fs.stat(norm);

    if (!this.isSupportedType(fileStat.type)) {
      throw new FileSystemError(
        'EINVAL',
        norm,
        'AssetDir only for regular and record files',
      );
    }

    const assetDirPath = this.getAssetDirPath(norm);

    if (await fs.exists(assetDirPath)) {
      const assetDirStat = await fs.stat(assetDirPath);
      if (assetDirStat.type !== FileType.DIRECTORY) {
        throw new FileSystemError('EEXIST', assetDirPath, 'Path exists but not a directory');
      }
      // 确保双向引用一致
      if (assetDirStat.metadata.ownerFileIno !== fileStat.ino
        || !assetDirStat.metadata.isAssetDir) {
        await fs.setMetadata(assetDirPath, {
          isAssetDir: true,
          ownerFileIno: fileStat.ino,
        });
      }
      if (fileStat.metadata.assetDirIno !== assetDirStat.ino) {
        await fs.setMetadata(norm, {
          assetDirIno: assetDirStat.ino,
        });
      }
      return assetDirPath;
    }

    // 创建 assetdir
    await fs.mkdir(assetDirPath);
    const newAssetDirStat = await fs.stat(assetDirPath);

    // 建立双向引用
    await fs.setMetadata(assetDirPath, {
      isAssetDir: true,
      ownerFileIno: fileStat.ino,
    });
    await fs.setMetadata(norm, {
      assetDirIno: newAssetDirStat.ino,
    });

    return assetDirPath;
  }

  /**
   * 删除文件的 assetdir
   */
  static async removeAssetDir(
    fs: FSFacade,
    filePath: string,
    removeContent: boolean = false,
  ): Promise<void> {
    const assetDirPath = await this.getAssetDir(fs, filePath);
    if (!assetDirPath) return;

    // 清除文件的 assetdir 引用
    await fs.setMetadata(filePath, { assetDirIno: undefined });

    // 删除 assetdir 目录
    await fs.rmdir(assetDirPath, { recursive: removeContent, force: true });
  }

  /**
   * 列出 assetdir 中的资产
   */
  static async listAssets(fs: FSFacade, filePath: string): Promise<string[]> {
    const assetDirPath = await this.getAssetDir(fs, filePath);
    if (!assetDirPath) return [];
    const entries = await fs.readdir(assetDirPath);
    return entries.map((e) => e.name);
  }

  // ============================================================
  // 同步操作（内部使用）
  // ============================================================

  /**
   * 同步删除：删除文件时处理 assetdir
   * 默认行为：自动删除 assetdir 及其内容
   *
   * @internal 由 FileOps.unlink 调用
   */
  static async syncUnlink(
    fs: FSFacade,
    filePath: string,
    strategy: 'keep' | 'remove' | 'orphan' = 'remove',
  ): Promise<void> {
    const assetDir = await this.getAssetDir(fs, filePath);
    if (!assetDir) return;

    switch (strategy) {
      case 'remove':
        // 先清除文件引用，再删除目录
        try {
          await fs.setMetadata(filePath, { assetDirIno: undefined });
        } catch {
          // 文件可能即将被删除，忽略
        }
        await fs.rmdir(assetDir, { recursive: true, force: true });
        break;

      case 'orphan':
        // 清除标记，降级为普通目录
        await fs.setMetadata(assetDir, {
          ownerFileIno: undefined,
          isAssetDir: false,
        });
        try {
          await fs.setMetadata(filePath, { assetDirIno: undefined });
        } catch {
          // best-effort
        }
        break;

      case 'keep':
      default:
        // 不做任何处理
        break;
    }
  }

  /**
   * 同步复制 assetdir
   *
   * @internal 由 FileOps.copy 调用
   */
  static async syncCopy(
    fs: FSFacade,
    srcPath: string,
    dstPath: string,
  ): Promise<void> {
    const srcAssetDir = await this.getAssetDir(fs, srcPath);
    if (!srcAssetDir) return;

    const dstAssetDir = this.getAssetDirPath(dstPath);

    // 如果目标 assetdir 已存在，先清理
    if (await fs.exists(dstAssetDir)) {
      await fs.rmdir(dstAssetDir, { recursive: true, force: true });
    }

    // 递归复制目录内容
    await this.copyDirRecursive(fs, srcAssetDir, dstAssetDir);

    // 建立新的双向引用
    const dstFileStat = await fs.stat(dstPath);
    const dstAssetDirStat = await fs.stat(dstAssetDir);

    await fs.setMetadata(dstAssetDir, {
      isAssetDir: true,
      ownerFileIno: dstFileStat.ino,
    });
    await fs.setMetadata(dstPath, {
      assetDirIno: dstAssetDirStat.ino,
    });
  }

  /**
   * 递归复制目录（内部方法）
   * 复制时自动清理 assetdir 相关元数据，避免脏引用
   */
  private static async copyDirRecursive(
    fs: FSFacade,
    srcDir: string,
    dstDir: string,
  ): Promise<void> {
    await fs.mkdir(dstDir);
    const entries = await fs.readdir(srcDir);

    for (const entry of entries) {
      const srcPath = PathUtils.join(srcDir, entry.name);
      const dstPath = PathUtils.join(dstDir, entry.name);
      const stat = await fs.stat(srcPath);

      if (stat.isDirectory()) {
        // 跳过嵌套的 assetdir —— assetdir 内的文件不应再有自己的 assetdir
        if (stat.metadata.isAssetDir) continue;
        await this.copyDirRecursive(fs, srcPath, dstPath);
      } else if (stat.isRecord()) {
        const fields = await fs.getAllFields(srcPath);
        const cleanMeta = this.cleanMetadataForCopy(stat.metadata);
        await fs.createRecord(dstPath, fields, {
          indexes: stat.recordIndexes,
          metadata: cleanMeta,
        });
      } else if (stat.isFile()) {
        const content = await fs.read(srcPath, { encoding: null });
        const cleanMeta = this.cleanMetadataForCopy(stat.metadata);
        await fs.create(dstPath, content, { metadata: cleanMeta });
      }
      // symlink / device 等类型跳过
    }
  }

  // ============================================================
  // 验证与修复
  // ============================================================

  /**
   * 验证 assetdir 一致性
   */
  static async validateConsistency(
    fs: FSFacade,
    filePath: string,
  ): Promise<string[]> {
    const issues: string[] = [];
    const norm = PathUtils.normalize(filePath);

    try {
      const fileStat = await fs.stat(norm);
      if (!this.isSupportedType(fileStat.type)) return issues;

      const assetDirIno = fileStat.metadata.assetDirIno as number | undefined;
      const expectedPath = this.getAssetDirPath(norm);

      if (assetDirIno && !await fs.exists(expectedPath)) {
        issues.push(`File references assetdir (ino=${assetDirIno}) but it does not exist`);
      }

      if (!assetDirIno && await fs.exists(expectedPath)) {
        const adStat = await fs.stat(expectedPath);
        if (adStat.metadata.isAssetDir) {
          issues.push('AssetDir exists but file has no assetDirIno reference');
        }
      }

      if (assetDirIno && await fs.exists(expectedPath)) {
        const adStat = await fs.stat(expectedPath);
        if (adStat.ino !== assetDirIno) {
          issues.push(`assetDirIno mismatch: expected ${adStat.ino}, got ${assetDirIno}`);
        }
        if (adStat.metadata.ownerFileIno !== fileStat.ino) {
          issues.push(`ownerFileIno mismatch: expected ${fileStat.ino}, got ${adStat.metadata.ownerFileIno}`);
        }
        if (!adStat.metadata.isAssetDir) {
          issues.push('AssetDir directory not marked as isAssetDir');
        }
      }
    } catch (err) {
      issues.push(`Validation error: ${err}`);
    }

    return issues;
  }

  /**
   * 修复 assetdir 一致性
   */
  static async repairConsistency(
    fs: FSFacade,
    filePath: string,
  ): Promise<void> {
    const norm = PathUtils.normalize(filePath);
    const fileStat = await fs.stat(norm);
    if (!this.isSupportedType(fileStat.type)) return;

    const expectedPath = this.getAssetDirPath(norm);
    const exists = await fs.exists(expectedPath);

    if (exists) {
      const adStat = await fs.stat(expectedPath);
      // 修复双向引用
      await fs.setMetadata(norm, { assetDirIno: adStat.ino });
      await fs.setMetadata(expectedPath, {
        isAssetDir: true,
        ownerFileIno: fileStat.ino,
      });
    } else if (fileStat.metadata.assetDirIno) {
      // assetdir 不存在，清除悬空引用
      await fs.setMetadata(norm, { assetDirIno: undefined });
    }
  }
}
