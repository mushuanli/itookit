/**
 * @file #mdxeditor/index.js
 * @desc mdx-editor library main entry point.
 */

import './index.css';

// --- Core UI Components ---
import { MDxEditor } from './editor/index.js';
// [FIX] Corrected path for MDxRenderer
import { MDxRenderer } from './editor/renderer.js';
import { MDxCoreEditor } from './editor/core-editor.js';
import * as commands from './editor/commands.js';

// --- Core Headless Engine ---
import { MDxProcessor } from './core/processor.js';
// [NEW] Import the new interface
import { IMentionProvider,slugify, simpleHash, escapeHTML } from  '@itookit/common';


import { MentionPlugin } from './enhanceplugins/mention/MentionPlugin.js';


// --- Plugins ---
import { ClozePlugin, ClozeAPIKey } from './mdxplugins/cloze.plugin.js';
// [NEW] 导入新创建的插件
import { ClozeControlsPlugin } from './mdxplugins/cloze-controls.plugin.js';
// [NEW] Import the new memory plugin
import { MemoryPlugin } from './mdxplugins/memory.plugin.js';
import { FoldablePlugin } from './mdxplugins/foldable.plugin.js';
import { FormattingPlugin } from './mdxplugins/formatting.plugin.js';
import { MathJaxPlugin } from './mdxplugins/mathjax.plugin.js';
import { MediaPlugin } from './mdxplugins/media.plugin.js';
import { MermaidPlugin } from './mdxplugins/mermaid.plugin.js';
import { TaskListPlugin } from './mdxplugins/task-list.plugin.js';
// +++ START MODIFICATION +++
import { CodeBlockControlsPlugin } from './mdxplugins/codeblock-controls.plugin.js';
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
