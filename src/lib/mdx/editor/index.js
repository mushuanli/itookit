/**
 * #mdx/editor/index.js
 * @file mdx-editor library main entry point.
 */

import './index.css';

// --- Core UI Components ---
import { MDxEditor } from './editor/index.js';
import { MDxRenderer } from './renderer/index.js';
// [NEW] Export the core editor for advanced use cases
import { MDxCoreEditor } from './editor/core-editor.js';
import * as commands from './editor/commands.js';

// --- Core Headless Engine ---
import { MDxProcessor } from './core/processor.js';
// [NEW] Import the new interface
import { IMemoryProvider } from '../../common/interfaces/IMemoryProvider.js';
import { IMentionProvider } from '../../common/interfaces/IMentionProvider.js';


import { MentionPlugin } from '../plugins/mention/MentionPlugin.js';

// --- Utilities ---
import { slugify, simpleHash, escapeHTML } from '../../common/utils/utils.js';

// --- Plugins ---
import { ClozePlugin, ClozeAPIKey } from './plugins/cloze.plugin.js';
// [NEW] 导入新创建的插件
import { ClozeControlsPlugin } from './plugins/cloze-controls.plugin.js';
// [NEW] Import the new memory plugin
import { MemoryPlugin } from './plugins/memory.plugin.js';
import { FoldablePlugin } from './plugins/foldable.plugin.js';
import { FormattingPlugin } from './plugins/formatting.plugin.js';
import { MathJaxPlugin } from './plugins/mathjax.plugin.js';
import { MediaPlugin } from './plugins/media.plugin.js';
import { MermaidPlugin } from './plugins/mermaid.plugin.js';
import { TaskListPlugin } from './plugins/task-list.plugin.js';
// +++ START MODIFICATION +++
import { CodeBlockControlsPlugin } from './plugins/codeblock-controls.plugin.js';
// +++ END MODIFICATION +++


// --- [REFACTORED] Unified Plugin Bundles ---
// A single, simple array of default plugins for the full MDxEditor experience.
const defaultPlugins = [
    new FoldablePlugin(),
    new ClozePlugin(),
    new MemoryPlugin(),
    new FormattingPlugin(),
    new MathJaxPlugin(),
    new MediaPlugin(),
    new MermaidPlugin(),
    new TaskListPlugin(),
    // +++ START MODIFICATION +++
    new CodeBlockControlsPlugin({ collapseThreshold: 100 }), 
    // +++ END MODIFICATION +++
];

export {
    // --- Core API ---
    MDxEditor,
    MDxRenderer,
    MDxCoreEditor, // Expose for users who might want a standalone CM editor
    MDxProcessor,
    // [NEW] Export interfaces
    IMemoryProvider,
    IMentionProvider,
    
    // --- Utilities & Commands ---
    slugify,
    simpleHash,
    escapeHTML,
    commands,

    // Plugins
    ClozePlugin,
    // [NEW] 导出新插件
    ClozeControlsPlugin,
    // [NEW] Export the memory plugin
    MemoryPlugin,
    MentionPlugin,
    FoldablePlugin,
    FormattingPlugin,
    MathJaxPlugin,
    MediaPlugin,
    MermaidPlugin,
    TaskListPlugin,
    // +++ START MODIFICATION +++
    CodeBlockControlsPlugin,
    // +++ END MODIFICATION +++
    
    // --- Keys & Bundles ---
    ClozeAPIKey,
    defaultPlugins, // Export the new unified bundle

};
