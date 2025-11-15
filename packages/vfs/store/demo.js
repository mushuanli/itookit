import { VFSStorage, VNode, VNodeType, ContentStore } from './vfs/store/index.js';

// 初始化存储层
const storage = new VFSStorage('my_vfs_db');
await storage.connect();

// 创建文件节点
const fileNode = new VNode(
  'node_001',
  'root_node',
  'example.txt',
  VNodeType.FILE,
  '/example.txt',
  'module_01'
);

// 单个操作
await storage.saveVNode(fileNode);

// 原子事务：同时保存节点和内容
const tx = await storage.beginTransaction();
try {
  await storage.saveVNode(fileNode, tx);
  
  const contentData = {
    contentRef: ContentStore.createContentRef(fileNode.nodeId),
    nodeId: fileNode.nodeId,
    content: 'Hello, VFS!',
    size: 11,
    createdAt: Date.now()
  };
  
  await storage.saveContent(contentData, tx);
  await tx.done;
} catch (error) {
  console.error('Transaction failed:', error);
}

// 查询操作
const children = await storage.getChildren('root_node');
const moduleNodes = await storage.getModuleNodes('module_01');
