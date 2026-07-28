# @itookit/vfs-protocol

VFS 协议层 — 接口、类型、常量和错误类。零运行时依赖。

## 边界

- 仅定义跨包契约（`IModuleFS`、`IFSDriver`、`IStorageBackend` 等）
- 不含任何实现代码
- 不含存储后端、引擎、UI 相关逻辑
- 错误类是纯数据结构，不依赖任何外部包

## 结构

```
src/
├── index.ts         统一导出
├── constants.ts     常量
├── core/            核心类型、错误、事件、选项
├── storage/         存储后端接口
├── capabilities/    可选能力子接口
├── device/          虚拟设备驱动接口
├── plugin/          插件/中间件系统
├── mount/           挂载系统
├── sync/            同步系统
├── services/        上层服务接口
├── IFile.ts         文件句柄
├── IMDXFile.ts      MDX 文件句柄
└── system-access.ts 系统访问接口
```

## 消费方

- `@itookit/vfslib` — VFS 引擎实现
- `@itookit/common` — re-export 向后兼容
- 各 UI/业务包 — 通过 `@itookit/common` 间接引用
