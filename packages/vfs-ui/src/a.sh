#!/bin/bash
# =============================================================
# VFS-UI 目录重构迁移脚本
# 从扁平结构 → 四层架构 (contracts/services/interaction/ui/shell)
# =============================================================

set -e

echo "🚀 开始 VFS-UI 目录重构..."

# 假设在 vfs-ui/ 根目录下执行
cd "$(dirname "$0")"

# ─────────────────────────────────────
# 1. 创建新目录结构
# ─────────────────────────────────────
echo "📁 创建目录结构..."

mkdir -p contracts
mkdir -p services
mkdir -p interaction/handlers
mkdir -p ui/base
mkdir -p ui/components/NodeList/items
mkdir -p ui/components/NodeList/handlers
mkdir -p ui/components/NodeList/popovers
mkdir -p ui/components/FileOutline
mkdir -p ui/components/MoveToModal
mkdir -p ui/components/TagEditor
mkdir -p shell
mkdir -p integrations
mkdir -p mention
mkdir -p utils
mkdir -p styles

# ─────────────────────────────────────
# 2. Layer 1: contracts/ (原 types/)
# ─────────────────────────────────────
echo "📦 迁移 Layer 1: contracts..."

# types.ts → contracts/types.ts
mv types/types.ts contracts/types.ts

# 新建文件（需要手动编写内容）
touch contracts/commands.ts
touch contracts/events.ts
touch contracts/ports.ts

# 清理空目录
rmdir types 2>/dev/null || true

# ─────────────────────────────────────
# 3. Layer 2: services/ (已存在部分)
# ─────────────────────────────────────
echo "📦 迁移 Layer 2: services..."

# 已在 services/ 目录的文件保持不动
# services/VFSService.ts        ✓ 已就位
# services/FileTypeRegistry.ts  ✓ 已就位
# services/IFileTypeRegistry.ts ✓ 已就位

# 从 stores/ 迁移
mv stores/VFSStore.ts services/VFSStore.ts
rmdir stores 2>/dev/null || true

# 从 mappers/ 迁移
mv mappers/NodeMapper.ts services/NodeMapper.ts
rmdir mappers 2>/dev/null || true

# 从 utils/ 迁移 parser（属于 services 层的数据处理）
mv utils/parser.ts services/parser.ts

# 新建文件
touch services/EngineAdapter.ts
touch services/StatePersistence.ts

# ─────────────────────────────────────
# 4. Layer 3: interaction/
# ─────────────────────────────────────
echo "📦 迁移 Layer 3: interaction..."

# Coordinator → 拆分为 CommandBus + EventBus
# 保留原文件作为参考，创建新文件
cp core/Coordinator.ts interaction/Coordinator.ts.bak
touch interaction/CommandBus.ts
touch interaction/EventBus.ts
touch interaction/index.ts

# 新建 Command Handlers
touch interaction/handlers/FileCommandHandler.ts
touch interaction/handlers/NavigationCommandHandler.ts
touch interaction/handlers/UICommandHandler.ts
touch interaction/handlers/ImportCommandHandler.ts
touch interaction/handlers/SelectionCommandHandler.ts

# ─────────────────────────────────────
# 5. Layer 4: ui/ (从 components/ + core/)
# ─────────────────────────────────────
echo "📦 迁移 Layer 4: ui..."

# BaseComponent → ui/base/
mv core/BaseComponent.ts ui/base/BaseComponent.ts

# 清理 core/ （Coordinator 已备份到 interaction/）
rm -f core/Coordinator.ts
# VFSUIManager 将被 shell/VFSUIShell.ts 替代，先备份
cp core/VFSUIManager.ts shell/VFSUIManager.ts.bak
rm -f core/VFSUIManager.ts
rmdir core 2>/dev/null || true

# ─── NodeList 组件树 ───
mv components/NodeList/NodeList.ts ui/components/NodeList/NodeList.ts
mv components/NodeList/NodeListRenderer.ts ui/components/NodeList/NodeListRenderer.ts
mv components/NodeList/NodeListState.ts ui/components/NodeList/NodeListState.ts
mv components/NodeList/Footer.ts ui/components/NodeList/Footer.ts
mv components/NodeList/templates.ts ui/components/NodeList/templates.ts

# NodeList items
mv components/NodeList/items/BaseNodeItem.ts ui/components/NodeList/items/BaseNodeItem.ts
mv components/NodeList/items/FileItem.ts ui/components/NodeList/items/FileItem.ts
mv components/NodeList/items/DirectoryItem.ts ui/components/NodeList/items/DirectoryItem.ts
mv components/NodeList/items/itemTemplates.ts ui/components/NodeList/items/itemTemplates.ts

# NodeList handlers
mv components/NodeList/handlers/SelectionHandler.ts ui/components/NodeList/handlers/SelectionHandler.ts
mv components/NodeList/handlers/DragDropHandler.ts ui/components/NodeList/handlers/DragDropHandler.ts
mv components/NodeList/handlers/ItemActionHandler.ts ui/components/NodeList/handlers/ItemActionHandler.ts
mv components/NodeList/handlers/ContextMenuHandler.ts ui/components/NodeList/handlers/ContextMenuHandler.ts

# NodeList popovers
mv components/NodeList/popovers/SettingsPopover.ts ui/components/NodeList/popovers/SettingsPopover.ts
mv components/NodeList/popovers/TagEditorPopover.ts ui/components/NodeList/popovers/TagEditorPopover.ts

# ─── FileOutline ───
mv components/FileOutline/FileOutline.ts ui/components/FileOutline/FileOutline.ts

# ─── MoveToModal ───
mv components/MoveToModal/MoveToModal.ts ui/components/MoveToModal/MoveToModal.ts

# ─── TagEditor ───
mv components/TagEditor/TagEditorComponent.ts ui/components/TagEditor/TagEditorComponent.ts

# 清理旧 components 目录树
find components -type d -empty -delete 2>/dev/null || true
rm -rf components 2>/dev/null || true

# ─────────────────────────────────────
# 6. Layer 5: shell/
# ─────────────────────────────────────
echo "📦 迁移 Layer 5: shell..."

# VFSUIShell.ts 需要全新编写，先基于备份
touch shell/VFSUIShell.ts

# ─────────────────────────────────────
# 7. 独立模块（不属于分层）
# ─────────────────────────────────────
echo "📦 迁移独立模块..."

# integrations/ 已存在
# integrations/editor-connector.ts  ✓ 已就位

# mention/ 移动（如果原来在根目录）
# 如果 mention/ 已存在则跳过
if [ -f "mention/BaseMentionSource.ts" ]; then
  echo "  mention/ 已就位，跳过"
fi

# utils/helpers.ts 保持不动
# utils/parser.ts 已迁移到 services/

# styles/ 保持不动

# ─────────────────────────────────────
# 8. 更新 index.ts 入口
# ─────────────────────────────────────
echo "📦 备份并准备更新 index.ts..."

cp index.ts index.ts.bak
# index.ts 内容需要手动更新 import 路径

# ─────────────────────────────────────
# 9. 批量更新 import 路径
# ─────────────────────────────────────
echo "🔧 批量更新 import 路径..."

# macOS 用 sed -i ''，Linux 用 sed -i
# 下面以 Linux 为准，macOS 需要加 ''
SED_INPLACE="sed -i"
# macOS 取消注释下面这行：
# SED_INPLACE="sed -i ''"

# --- contracts 引用更新 ---

# types/types → contracts/types
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./types/types'|from '../contracts/types'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./types/types'|from '../../contracts/types'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./\.\./types/types'|from '../../../contracts/types'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\./types/types'|from './contracts/types'|g" {} +

# --- stores → services ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./stores/VFSStore'|from '../services/VFSStore'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./stores/VFSStore'|from '../../services/VFSStore'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./\.\./stores/VFSStore'|from '../../../services/VFSStore'|g" {} +

# --- mappers → services ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./mappers/NodeMapper'|from '../services/NodeMapper'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./mappers/NodeMapper'|from '../../services/NodeMapper'|g" {} +

# --- core/Coordinator → interaction/CommandBus ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./core/Coordinator'|from '../interaction/CommandBus'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./core/Coordinator'|from '../../interaction/CommandBus'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\./core/Coordinator'|from './interaction/CommandBus'|g" {} +

# --- core/BaseComponent → ui/base/BaseComponent ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./core/BaseComponent'|from '../../ui/base/BaseComponent'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./core/BaseComponent'|from '../ui/base/BaseComponent'|g" {} +

# --- utils/parser → services/parser ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./utils/parser'|from '../services/parser'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./\.\./utils/parser'|from '../../services/parser'|g" {} +

# --- components 路径前缀变为 ui/components ---
# 组件内部相对引用大多不需要改（因为整个子树一起移动了）
# 但从外部引用组件的路径需要更新

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\.\./components/|from '../ui/components/|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\./components/|from './ui/components/|g" {} +

# --- core/VFSUIManager → shell/VFSUIShell ---

find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|from '\./core/VFSUIManager'|from './shell/VFSUIShell'|g" {} +
find . -name '*.ts' -not -path './node_modules/*' -not -path './*.bak' \
  -exec $SED_INPLACE "s|VFSUIManager|VFSUIShell|g" {} +

# ─────────────────────────────────────
# 10. 验证结构
# ─────────────────────────────────────
echo ""
echo "✅ 迁移完成！最终目录结构："
echo ""

tree -I 'node_modules|dist|.git' --dirsfirst -L 4

echo ""
echo "═══════════════════════════════════════════"
echo "📋 后续手动操作清单："
echo "═══════════════════════════════════════════"
echo ""
echo "1. 编写新文件内容:"
echo "   - contracts/commands.ts    (CommandMap 类型定义)"
echo "   - contracts/events.ts      (PublicEventMap 类型定义)"
echo "   - contracts/ports.ts       (IStateReader/IStateWriter/ICommandExecutor/IEventEmitter/IDataOperations)"
echo "   - interaction/CommandBus.ts (类型安全命令总线)"
echo "   - interaction/EventBus.ts  (公共事件总线)"
echo "   - services/EngineAdapter.ts(引擎事件→Store 适配器)"
echo "   - services/StatePersistence.ts (localStorage 持久化)"
echo "   - shell/VFSUIShell.ts      (基于 VFSUIManager.ts.bak 重构)"
echo ""
echo "2. 更新现有文件:"
echo "   - services/VFSStore.ts     (implements IStateReader, IStateWriter)"
echo "   - services/VFSService"
