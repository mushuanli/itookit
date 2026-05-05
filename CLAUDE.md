Build tools by package type:
- Logic-only packages (`common`, `vfslib`, `device-llm`, `llm-kernel`, `llm-engine`, `tools`, vfsdrivers): **tsup** → CJS+ESM + `.d.ts`
- UI packages (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`): **vite build**

[目录结构](./doc/pkgstructure.md)
[架构设计](./doc/architecture.md)
[VFS 设计](./doc/design/VFS-design.md)
