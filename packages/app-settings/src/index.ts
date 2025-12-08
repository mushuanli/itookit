// @file: app-settings/index.ts
// 导出样式 (需要在 web-app 中 import '@itookit/settings/style.css')
// 注意：你需要配置构建工具支持 css 导出，或者直接拷贝 css 文件
import './styles/styles.css';

// 导出类型
export * from './types';

// 导出服务
export { SettingsService } from './services/SettingsService';

// 导出引擎
export { SettingsEngine } from './engine/SettingsEngine';

// 导出工厂
export { createSettingsFactory } from './factories/settingsFactory';

// 如果需要单独导出某些 Editor (通常通过工厂使用，不需要单独导出)
// export { TagSettingsEditor } from './editors/TagSettingsEditor';