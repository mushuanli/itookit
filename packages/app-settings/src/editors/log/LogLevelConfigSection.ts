/**
 * @file app-settings/editors/log/LogLevelConfigSection.ts
 * @description 日志级别配置面板
 */

import { getLogger, LogLevel, LogLevelNames, escapeHTML, Toast } from '@itookit/common';

interface ModuleLevelConfig {
    module: string;
    level: LogLevel;
}

export class LogLevelConfigSection {
    private container: HTMLElement;
    private moduleConfigs: ModuleLevelConfig[] = [];

    constructor(container: HTMLElement) {
        this.container = container;
    }

    async init(): Promise<void> {
        this.loadExistingConfigs();
        this.render();
    }

    private loadExistingConfigs(): void {
        // 从 localStorage 加载已保存的配置
        try {
            const saved = localStorage.getItem('log_level_configs');
            if (saved) {
                this.moduleConfigs = JSON.parse(saved);
                // 应用到 logger
                const logger = getLogger();
                this.moduleConfigs.forEach(c => logger.setLevel(c.module, c.level));
            }
        } catch (e) {
            console.warn('Failed to load log level configs:', e);
        }
    }

    private saveConfigs(): void {
        try {
            localStorage.setItem('log_level_configs', JSON.stringify(this.moduleConfigs));
        } catch (e) {
            console.warn('Failed to save log level configs:', e);
        }
    }

    render(): void {
        const logger = getLogger();
        const globalLevel = logger.getLevel('*');

        this.container.innerHTML = `
            <div class="settings-section">
                <div class="settings-section__header">
                    <h3 class="settings-section__title">
                        <span class="settings-section__icon">⚙️</span>
                        日志级别配置
                    </h3>
                </div>
                <div class="settings-section__content">
                    <div class="log-level-config">
                        <!-- 全局级别 -->
                        <div class="log-level-config__global">
                            <label class="log-level-config__label">全局默认级别</label>
                            <select class="settings-select" id="global-level">
                                ${this.renderLevelOptions(globalLevel)}
                            </select>
                        </div>

                        <!-- 模块级别列表 -->
                        <div class="log-level-config__modules">
                            <div class="log-level-config__modules-header">
                                <span>模块级别覆盖</span>
                            </div>
                            <div class="log-level-config__modules-list" id="module-list">
                                ${this.renderModuleList()}
                            </div>
                            <button class="settings-btn settings-btn--secondary" id="add-module-btn">
                                <i class="fas fa-plus"></i> 添加模块
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    private renderLevelOptions(selectedLevel: LogLevel): string {
        return Object.entries(LogLevelNames)
            .filter(([key]) => parseInt(key) !== LogLevel.SILENT)
            .map(([key, name]) => {
                const level = parseInt(key);
                const selected = level === selectedLevel ? 'selected' : '';
                return `<option value="${level}" ${selected}>${name}</option>`;
            })
            .join('');
    }

    private renderModuleList(): string {
        if (this.moduleConfigs.length === 0) {
            return `
                <div class="log-level-config__empty">
                    暂无模块级别覆盖配置
                </div>
            `;
        }

        return this.moduleConfigs.map((config, index) => `
            <div class="log-level-config__module-item" data-index="${index}">
                <span class="log-level-config__module-name">${escapeHTML(config.module)}</span>
                <select class="settings-select settings-select--sm module-level-select" data-index="${index}">
                    ${this.renderLevelOptions(config.level)}
                </select>
                <button class="settings-btn settings-btn--icon settings-btn--danger remove-module-btn" data-index="${index}" title="移除">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    private bindEvents(): void {
        const logger = getLogger();

        // 全局级别变更
        const globalSelect = this.container.querySelector('#global-level') as HTMLSelectElement;
        globalSelect?.addEventListener('change', () => {
            const level = parseInt(globalSelect.value) as LogLevel;
            logger.setLevel('*', level);
            Toast.success(`全局日志级别已设置为 ${LogLevelNames[level]}`);
        });

        // 模块级别变更
        this.container.querySelectorAll('.module-level-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const target = e.target as HTMLSelectElement;
                const index = parseInt(target.dataset.index || '0');
                const level = parseInt(target.value) as LogLevel;

                if (this.moduleConfigs[index]) {
                    this.moduleConfigs[index].level = level;
                    logger.setLevel(this.moduleConfigs[index].module, level);
                    this.saveConfigs();
                    Toast.success(`模块 ${this.moduleConfigs[index].module} 级别已更新`);
                }
            });
        });

        // 移除模块
        this.container.querySelectorAll('.remove-module-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const index = parseInt(target.dataset.index || '0');

                if (this.moduleConfigs[index]) {
                    const moduleName = this.moduleConfigs[index].module;
                    this.moduleConfigs.splice(index, 1);
                    // 重置为全局级别
                    logger.setLevel(moduleName, logger.getLevel('*'));
                    this.saveConfigs();
                    this.render();
                    Toast.info(`已移除模块 ${moduleName} 的级别覆盖`);
                }
            });
        });

        // 添加模块
        const addBtn = this.container.querySelector('#add-module-btn');
        addBtn?.addEventListener('click', () => this.showAddModuleDialog());
    }

    private showAddModuleDialog(): void {
        const moduleName = prompt('请输入模块名称:');
        if (!moduleName?.trim()) return;

        const trimmed = moduleName.trim();

        // 检查重复
        if (this.moduleConfigs.some(c => c.module === trimmed)) {
            Toast.warning(`模块 ${trimmed} 已存在`);
            return;
        }

        const logger = getLogger();
        this.moduleConfigs.push({
            module: trimmed,
            level: LogLevel.DEBUG
        });
        logger.setLevel(trimmed, LogLevel.DEBUG);
        this.saveConfigs();
        this.render();
        Toast.success(`已添加模块 ${trimmed}`);
    }

    refresh(): void {
        this.render();
    }

    destroy(): void {
        // 清理
    }
}
