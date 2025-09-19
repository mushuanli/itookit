// src/common/dom.js

// 全局辅助函数
export const $ = (selector) => document.querySelector(selector);
export const $id = (id) => document.getElementById(id);

// 全局布局元素
export const appViews = {
    anki: $id('anki-view'),
    task: $id('task-view'),
    agent: $id('agent-view'),
    settings: $id('settings-view'),
};