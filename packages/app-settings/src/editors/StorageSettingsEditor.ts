// @file: app-settings/editors/StorageSettingsEditor.ts
import { BaseSettingsEditor, Modal, Toast } from '@itookit/common';
import { SettingsService, LocalSnapshot, SyncConfig, SyncStatus, SyncMode } from '../services/SettingsService'; 
import { SettingsState } from '../types';

const SETTINGS_LABELS: Record<keyof SettingsState, string> = {
    connections: '🤖 连接 (Connections)',
    mcpServers: '🔌 MCP 服务器',
    tags: '🏷️ 标签 (Tags)',
    contacts: '📒 通讯录'
};

export class StorageSettingsEditor extends BaseSettingsEditor<SettingsService> {
    private storageInfo: any = null;
    private snapshots: LocalSnapshot[] = []; 
    // [新增] 同步配置缓存
    private syncConfig: SyncConfig = {
        serverUrl: '',
        username: '',
        password: '',
        strategy: 'manual',
        autoSync: false
    };
    private syncStatus: SyncStatus = { state: 'idle', lastSyncTime: null };

    async init(container: HTMLElement) {
        await super.init(container);
        await Promise.all([
            this.loadStorageInfo(),
            this.loadSnapshots(),
            this.loadSyncConfig()
        ]);
    }

    async loadStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                this.storageInfo = await navigator.storage.estimate();
                this.render();
            } catch (e) { console.error(e); }
        }
    }

    async loadSnapshots() {
        try {
            this.snapshots = await this.service.listLocalSnapshots();
            this.render();
        } catch (e) { console.error('Failed to list snapshots', e); }
    }

    async loadSyncConfig() {
        try {
            this.syncConfig = await this.service.getSyncConfig();
            this.syncStatus = await this.service.getSyncStatus();
            this.render();
        } catch (e) { console.error('Failed to load sync config', e); }
    }

    render() {
        const usage = this.storageInfo?.usage || 0;
        const quota = this.storageInfo?.quota || 1;
        const percent = ((usage / quota) * 100).toFixed(1);
        const usageMB = (usage / 1024 / 1024).toFixed(2);

        // 2. [核心修复] 安全获取 Snapshots，防止 undefined
        const snapshots = this.snapshots || [];

        // 同步状态 UI 辅助
        const syncStateColors: Record<string, string> = {
            'idle': '#aaa',
            'syncing': 'var(--st-color-primary)',
            'error': 'var(--st-color-danger)',
            'success': 'var(--st-color-success)'
        };
        
        const syncLabelMap: Record<string, string> = {
            'idle': '就绪',
            'syncing': '同步中...',
            'error': '错误',
            'success': '同步成功'
        };
        const syncStateLabel = syncLabelMap[this.syncStatus.state] || '未知';
        // 新增的部分：高级修复区
        const advancedOpsHtml = `
            <div style="margin-top:20px; padding-top:15px; border-top:1px dashed var(--st-border-color);">
                <div style="font-size:0.85em; color:var(--st-text-secondary); margin-bottom:10px;">🛡️ 数据修复与强制同步</div>
                <div style="display:flex; gap:10px;">
                    <button id="btn-force-push" class="settings-btn settings-btn--sm settings-btn--secondary" title="将本地所有文件覆盖到服务器">
                        <i class="fas fa-arrow-up"></i> 强制上传 (Local ➔ Server)
                    </button>
                    <button id="btn-force-pull" class="settings-btn settings-btn--sm settings-btn--secondary" title="下载服务器所有文件覆盖本地">
                        <i class="fas fa-arrow-down"></i> 强制下载 (Server ➔ Local)
                    </button>
                </div>
                <small style="display:block; margin-top:5px; color:#999; font-size:0.75em;">
                    注意：强制操作会忽略版本冲突，直接覆盖目标端的数据。
                </small>
            </div>
        `;

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <h2 class="settings-page__title">存储与数据</h2>
                </div>

                <div class="settings-storage-overview">
                    <div class="settings-storage-visual">
                        <svg width="100" height="100" viewBox="0 0 36 36" class="settings-circular-chart">
                            <path class="settings-chart-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path class="settings-chart-fill" stroke-dasharray="${percent}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <text x="18" y="20.35" class="settings-chart-text">${percent}%</text>
                        </svg>
                        <div style="margin-left: 20px;">
                            <div class="settings-stat-item">
                                <span class="settings-detail-item__label">本地占用</span>
                                <span class="settings-detail-item__value" style="font-size:1.5em; font-weight:bold;">${usageMB} MB</span>
                            </div>
                            <div style="font-size:0.85em; color:var(--st-text-secondary); margin-top:5px;">
                                浏览器配额: ${(quota / 1024 / 1024 / 1024).toFixed(1)} GB
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. 远程同步 (Remote Sync) -->
                <div class="settings-section">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <div>
                            <h3 class="settings-section__title" style="margin:0">☁️ 远程同步</h3>
                            <div style="display:flex; align-items:center; gap:8px; margin-top:5px; font-size:0.85em; color:var(--st-text-secondary);">
                                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${syncStateColors[this.syncStatus.state]}"></span>
                                <span>${syncStateLabel}</span>
                                ${this.syncStatus.lastSyncTime ? `<span>• 上次同步: ${new Date(this.syncStatus.lastSyncTime).toLocaleTimeString()}</span>` : ''}
                            </div>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button id="btn-sync-now" class="settings-btn settings-btn--primary" ${this.syncStatus.state === 'syncing' ? 'disabled' : ''}>
                                <i class="fas fa-sync ${this.syncStatus.state === 'syncing' ? 'fa-spin' : ''}"></i> 同步
                            </button>
                            <button id="btn-toggle-sync-config" class="settings-btn settings-btn--secondary">配置</button>
                        </div>
                    </div>

                    <!-- 同步配置表单 -->
                    <div id="sync-config-panel" style="display:none; background:var(--st-bg-tertiary); padding:15px; border-radius:8px; margin-bottom:15px;">
                        <div class="settings-form-group">
                            <label>服务器地址 (Endpoint)</label>
                            <input type="text" id="inp-sync-url" class="settings-input" placeholder="https://127.0.0.1:3443" value="${this.syncConfig.serverUrl || ''}">
                            <small style="color:var(--st-text-secondary); font-size:0.75em;">若是本地自签名证书，请先在浏览器访问一次该地址并接受证书。</small>
                        </div>
                        
                        <div class="settings-form-row">
                            <div class="settings-form-group" style="flex:1;">
                                <label>用户名</label>
                                <input type="text" id="inp-sync-user" class="settings-input" placeholder="username" value="${this.syncConfig.username || ''}">
                            </div>
                            <div class="settings-form-group" style="flex:1;">
                                <label>密码</label>
                                <input type="password" id="inp-sync-pass" class="settings-input" placeholder="••••••••" value="${this.syncConfig.password || ''}">
                            </div>
                        </div>

                        <div class="settings-form-row">
                            <div class="settings-form-group" style="flex:1">
                                <label>常规同步策略</label>
                                <select id="sel-sync-strategy" class="settings-select">
                                    <option value="manual" ${this.syncConfig.strategy === 'manual' ? 'selected' : ''}>手动同步 (Manual)</option>
                                    <option value="bidirectional" ${this.syncConfig.strategy === 'bidirectional' ? 'selected' : ''}>双向智能 (Smart)</option>
                                    <option value="push" ${this.syncConfig.strategy === 'push' ? 'selected' : ''}>仅上传 (Push)</option>
                                    <option value="pull" ${this.syncConfig.strategy === 'pull' ? 'selected' : ''}>仅下载 (Pull)</option>
                                </select>
                            </div>
                            <div class="settings-form-group" style="flex:0 0 auto; display:flex; align-items:flex-end;">
                                <label class="settings-checkbox-row" style="margin-bottom:10px;">
                                    <input type="checkbox" id="chk-auto-sync" ${this.syncConfig.autoSync ? 'checked' : ''}>
                                    <span>自动同步</span>
                                </label>
                            </div>
                        </div>

                        ${this.syncStatus.errorMessage ? `<div style="color:var(--st-color-danger); font-size:0.85em; margin-top:10px;">❌ ${this.syncStatus.errorMessage}</div>` : ''}

                        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:15px; padding-top:10px; border-top:1px solid var(--st-border-color);">
                            <button id="btn-test-conn" class="settings-btn settings-btn--sm settings-btn--secondary">测试连接</button>
                            <button id="btn-save-sync" class="settings-btn settings-btn--sm settings-btn--primary">保存配置</button>
                        </div>

                        ${advancedOpsHtml} <!-- 插入强制同步区域 -->
                    </div>
                </div>

                <!-- 3. 本地快照 -->
                <div class="settings-section">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <div>
                            <h3 class="settings-section__title" style="margin:0">📦 本地快照</h3>
                            <p class="settings-page__description" style="margin:5px 0 0 0">浏览器内的秒级数据库备份，用于快速回滚。</p>
                        </div>
                        <button id="btn-create-snapshot" class="settings-btn settings-btn--secondary"><i class="fas fa-camera"></i> 新建快照</button>
                    </div>
                    
                    <div class="settings-snapshot-list">
                        ${snapshots.length === 0
                            ? `<div class="settings-empty settings-empty--mini">暂无快照</div>` 
                            : snapshots.map(s => `
                                <div class="settings-list-item snapshot-item">
                                    <div class="settings-list-item__icon">🕰️</div>
                                    <div class="settings-list-item__info">
                                        <p class="settings-list-item__title">${s.displayName}</p>
                                        <p class="settings-list-item__desc">
                                            ${new Date(s.createdAt).toLocaleString()} • ${(s.size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                    </div>
                                    <div class="settings-snapshot-actions">
                                        <button class="settings-btn settings-btn--sm settings-btn--secondary btn-restore-snap" data-name="${s.name}" title="回滚到此状态">恢复</button>
                                        <button class="settings-btn settings-btn--sm settings-btn--danger btn-del-snap" data-name="${s.name}"><i class="fas fa-trash"></i></button>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>

                <!-- 4. 导入/导出 -->
                <div class="settings-section" style="border-top: 1px solid var(--st-border-color); padding-top: 20px;">
                    <h3 class="settings-section__title">数据迁移 (JSON)</h3>
                    <div class="settings-storage-actions">
                        <div class="settings-action-card">
                            <div class="settings-action-card__icon">📤</div>
                            <div style="flex:1;">
                                <h3 style="margin:0 0 5px 0; font-size:1em;">导出备份</h3>
                                <p style="margin:0; font-size:0.8em; color:var(--st-text-secondary);">导出系统配置和文档为 JSON 文件</p>
                            </div>
                            <button id="btn-export-mixed" class="settings-btn settings-btn--secondary">选择内容...</button>
                        </div>
                        <div class="settings-action-card">
                            <div class="settings-action-card__icon">📥</div>
                            <div style="flex:1;">
                                <h3 style="margin:0 0 5px 0; font-size:1em;">恢复/导入</h3>
                                <p style="margin:0; font-size:0.8em; color:var(--st-text-secondary);">支持增量合并或全量覆盖</p>
                            </div>
                            <button id="btn-import-mixed" class="settings-btn settings-btn--primary">导入文件...</button>
                        </div>
                    </div>
                </div>

                <!-- 5. 危险区 -->
                <div class="settings-section" style="margin-top: 40px; border-top: 1px solid var(--st-border-color); padding-top: 20px;">
                    <details>
                        <summary style="cursor:pointer; color:var(--st-text-secondary); font-size:0.9em;">高级选项 / 危险操作</summary>
                        <div class="settings-storage-actions" style="margin-top:15px;">
                            <div class="settings-action-card settings-action-card--danger">
                                <div class="settings-action-card__icon">💣</div>
                                <div style="flex:1">
                                    <h3>工厂重置</h3>
                                    <p style="font-size:0.8em; color:#666;">抹除所有数据并重置为初始状态</p>
                                </div>
                                <button id="btn-reset" class="settings-btn settings-btn--danger">清空所有数据</button>
                            </div>
                        </div>
                    </details>
                </div>
            </div>
            <style>
                .settings-storage-visual { display: flex; align-items: center; padding: 20px; background: var(--st-bg-secondary); border-radius: 12px; }
                .settings-circular-chart { display: block; margin: 0 auto; max-width: 80%; max-height: 250px; }
                .settings-chart-bg { fill: none; stroke: var(--st-border-color); stroke-width: 3.8; }
                .settings-chart-fill { fill: none; stroke: var(--st-color-primary); stroke-width: 2.8; stroke-linecap: round; transition: stroke-dasharray 0.5s ease; }
                .settings-chart-text { fill: var(--st-text-primary); font-family: sans-serif; font-weight: bold; font-size: 0.5em; text-anchor: middle; }
                
                .settings-snapshot-list { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
                .snapshot-item { display: flex; align-items: center; padding: 10px; background: var(--st-bg-tertiary); border-radius: 8px; border: 1px solid transparent; }
                .snapshot-item:hover { border-color: var(--st-border-color); }
                .settings-snapshot-actions { display: flex; gap: 8px; margin-left: auto; }
                
                .settings-form-row { display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 15px; }
                .settings-action-card { display: flex; align-items: center; gap: 15px; padding: 15px; background: var(--st-bg-tertiary); border-radius: 8px; margin-bottom: 10px; }
                .settings-action-card--danger { background: #fee2e2; border: 1px solid #fca5a5; }
                .settings-action-card--danger h3 { color: #991b1b; }
            </style>
        `;
        
        this.bindEvents();
    }

    private bindEvents() {
        this.clearListeners();
        
        // JSON Actions
        this.bindButton('#btn-export-mixed', () => this.openExportModal());
        this.bindButton('#btn-import-mixed', () => this.triggerImportFlow());
        this.bindButton('#btn-reset', () => this.resetApp());

        // Snapshot Actions
        this.bindButton('#btn-create-snapshot', () => this.createSnapshot());

        // Snapshot List Delegation
        const list = this.container.querySelector('.settings-snapshot-list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const target = e.target as HTMLElement;
                const restoreBtn = target.closest('.btn-restore-snap') as HTMLElement;
                const delBtn = target.closest('.btn-del-snap') as HTMLElement;
                if (restoreBtn) this.restoreSnapshot(restoreBtn.dataset.name!);
                if (delBtn) this.deleteSnapshot(delBtn.dataset.name!);
            });
        }

        // Sync Actions
        this.bindButton('#btn-toggle-sync-config', async () => {
            const panel = this.container.querySelector('#sync-config-panel') as HTMLElement;
            const isHidden = panel.style.display === 'none';
            
            if (isHidden) {
                // 此时要打开
                panel.style.display = 'block';
            } else {
                // 此时要关闭 -> 触发自动保存
                try {
                    await this.saveConfigFromUI(); // 保存
                    Toast.success('配置已自动保存');
                    panel.style.display = 'none';
                } catch (e: any) {
                    // 如果校验失败（比如没填地址），不关闭面板
                    console.warn('Auto-save skipped:', e.message);
                    panel.style.display = 'none'; // 依然关闭，或者也可以选择保持打开并报错
                }
            }
        });

        this.bindButton('#btn-save-sync', async () => {
            try {
                await this.saveConfigFromUI();
                Toast.success('配置已保存');
            } catch(e) { Toast.error('保存失败'); }
        });

        this.bindButton('#btn-test-conn', async () => {
            const btn = this.container.querySelector('#btn-test-conn') as HTMLButtonElement;
            const originalText = btn.innerText;
            btn.innerText = '连接中...';
            btn.disabled = true;
            try {
                const url = this.getVal('#inp-sync-url');
                const user = this.getVal('#inp-sync-user');
                const pass = this.getVal('#inp-sync-pass');
                const success = await this.service.testConnection(url, user, pass);
                if (success) Toast.success('连接成功');
                else Toast.error('认证失败');
            } catch (e) {
                Toast.error('连接错误: ' + (e as any).message);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });

        this.bindButton('#btn-sync-now', () => this.handleSyncAction('standard'));

        // [改进 3] 强制同步按钮绑定
        this.bindButton('#btn-force-push', () => this.confirmForceSync('force_push'));
        this.bindButton('#btn-force-pull', () => this.confirmForceSync('force_pull'));
    }

    // 新增：通用的 UI 保存逻辑
    private async saveConfigFromUI() {
        const url = this.getVal('#inp-sync-url');
        const user = this.getVal('#inp-sync-user');
        const pass = this.getVal('#inp-sync-pass');
        const strategy = (this.container.querySelector('#sel-sync-strategy') as HTMLSelectElement).value;
        const autoSync = (this.container.querySelector('#chk-auto-sync') as HTMLInputElement).checked;

        if (!url || !user) {
            throw new Error('Required fields missing');
        }

        await this.service.saveSyncConfig({
            serverUrl: url,
            username: user,
            password: pass,
            strategy: strategy as any,
            autoSync
        });
        await this.loadSyncConfig(); // 刷新本地状态
    }

    // 新增：统一同步处理逻辑
    private async handleSyncAction(mode: SyncMode) {
        try {
            // 同步前尝试自动保存（如果面板开着）
            const panel = this.container.querySelector('#sync-config-panel') as HTMLElement;
            if (panel && panel.style.display !== 'none') {
                await this.saveConfigFromUI().catch(() => {}); // 忽略保存错误，继续尝试同步
            }

            if (!this.syncConfig.serverUrl) {
                Toast.warning('请先填写服务器地址');
                // 自动展开面板
                if (panel) panel.style.display = 'block';
                return;
            }

            this.syncStatus.state = 'syncing';
            this.render(); // 更新 UI 状态
            
            await this.service.triggerSync(mode);
            
            Toast.success(mode === 'standard' ? '同步完成' : '强制同步完成');
        } catch(e: any) {
            console.error(e);
            let msg = '同步失败';
            if (e.message.includes('Failed to fetch')) msg += ': 网络错误或证书未信任';
            else msg += ': ' + e.message;
            Toast.error(msg);
        } finally {
            await this.loadSyncConfig(); // 刷新状态显示
        }
    }


    // 新增：强制同步确认弹窗
    private confirmForceSync(mode: SyncMode) {
        const isPush = mode === 'force_push';
        const title = isPush ? '⚠️ 确认强制上传？' : '⚠️ 确认强制下载？';
        const msg = isPush 
            ? '此操作将把<b>本地的所有文件</b>上传到服务器。<br>服务器上已存在的同名文件将被<b>直接覆盖</b>。'
            : '此操作将从服务器下载所有文件。<br>本地已存在的同名文件将被<b>直接覆盖</b>。';

        Modal.confirm(title, msg, async () => {
            await this.handleSyncAction(mode);
        });
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    private getVal(selector: string): string {
        return (this.container.querySelector(selector) as HTMLInputElement)?.value || '';
    }

    private async createSnapshot() {
        const btn = this.container.querySelector('#btn-create-snapshot') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '创建中...';
        try {
            await this.service.createSnapshot();
            Toast.success('快照创建成功');
            await this.loadSnapshots();
        } catch (e) {
            Toast.error('创建失败');
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-camera"></i> 创建快照';
        }
    }

    private restoreSnapshot(name: string) {
        Modal.confirm(
            '确认恢复', 
            '<b>警告：此操作将覆盖当前所有数据！</b><br>系统将回滚到快照点的状态。建议先创建一个当前状态的快照。',
            async () => {
                try {
                    Toast.info('正在恢复...');
                    await this.service.restoreSnapshot(name);
                    Toast.success('恢复成功，正在刷新...');
                    setTimeout(() => window.location.reload(), 1000);
                } catch (e) {
                    Toast.error('恢复失败');
                    console.error(e);
                }
            }
        );
    }

    private async deleteSnapshot(name: string) {
        if (!confirm('确定删除此快照吗？')) return;
        try {
            await this.service.deleteSnapshot(name);
            Toast.success('已删除');
            await this.loadSnapshots();
        } catch (e) {
            Toast.error('删除失败');
        }
    }

    // --- JSON Export/Import Logic (Existing) ---

    private openExportModal() {
        const settingsKeys = this.service.getAvailableSettingsKeys();
        const workspaces = this.service.getAvailableWorkspaces();

        const settingsHtml = settingsKeys.map(key => `
            <label class="settings-checkbox-row">
                <input type="checkbox" name="export-settings" value="${key}" checked>
                <span>${SETTINGS_LABELS[key] || key}</span>
            </label>
        `).join('');

        const workspacesHtml = workspaces.length > 0 
            ? workspaces.map(ws => `
                <label class="settings-checkbox-row">
                    <input type="checkbox" name="export-modules" value="${ws.name}">
                    <div style="display:flex; flex-direction:column;">
                        <span>📂 ${ws.name}</span>
                        <small style="color:#999; font-size:0.8em;">${ws.description || '用户工作区'}</small>
                    </div>
                </label>
            `).join('')
            : `<div style="padding:10px; color:#999; font-style:italic;">无可用工作区</div>`;

        const content = `
            <div class="settings-export-modal-content" style="padding: 0 10px;">
                <div style="margin-bottom: 20px;">
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color); padding-bottom:5px;">⚙️ 系统配置</h4>
                    <div class="settings-checklist-grid">${settingsHtml}</div>
                </div>
                <div>
                    <h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--st-border-color); padding-bottom:5px;">📚 文档工作区</h4>
                    <div class="settings-checklist-grid">${workspacesHtml}</div>
                </div>
                <div style="margin-top:15px; text-align:right;">
                    <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = true)">全选</small>
                    <small class="settings-link-btn" onclick="document.querySelectorAll('.settings-checklist-grid input').forEach(c => c.checked = false)">全不选</small>
                </div>
            </div>
            <style>
                .settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .settings-checkbox-row { display: flex; align-items: center; gap: 8px; padding: 5px; cursor: pointer; border-radius: 4px; }
                .settings-checkbox-row:hover { background: var(--st-bg-tertiary); }
                .settings-link-btn { cursor: pointer; color: var(--st-color-primary); margin-left: 10px; }
                .settings-link-btn:hover { text-decoration: underline; }
            </style>
        `;

        new Modal('选择导出内容', content, {
            confirmText: '导出',
            onConfirm: async () => {
                const sInputs = document.querySelectorAll<HTMLInputElement>('input[name="export-settings"]:checked');
                const mInputs = document.querySelectorAll<HTMLInputElement>('input[name="export-modules"]:checked');
                
                const selectedSettings = Array.from(sInputs).map(i => i.value as keyof SettingsState);
                const selectedModules = Array.from(mInputs).map(i => i.value);

                if (selectedSettings.length === 0 && selectedModules.length === 0) {
                    Toast.warning('请至少选择一项内容');
                    return false;
                }

                try {
                    const data = await this.service.exportMixedData(selectedSettings, selectedModules);
                    const date = new Date().toISOString().slice(0, 10);
                    this.downloadJson(data, `mindos-backup-${date}.json`);
                    Toast.success(`导出完成: ${selectedSettings.length} 项配置, ${selectedModules.length} 个工作区`);
                } catch (e) {
                    console.error(e);
                    Toast.error('导出失败');
                }
                return true;
            }
        }).show();
    }

    // --- Import UI Logic ---

    private triggerImportFlow() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e: any) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev: any) => {
                try {
                    const json = JSON.parse(ev.target.result);
                    this.showImportSelectionModal(json);
                } catch (err) {
                    Toast.error('无法解析 JSON 文件');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    private showImportSelectionModal(json: any) {
        const availableSettings = this.service.getAvailableSettingsKeys().filter(k => {
            return (json.settings && Array.isArray(json.settings[k])) || Array.isArray(json[k]);
        });
        let availableModules: any[] = [];
        if (json.modules && Array.isArray(json.modules)) {
            availableModules = json.modules;
        }

        if (availableSettings.length === 0 && availableModules.length === 0) {
            Toast.error('文件中未发现可识别的备份数据');
            return;
        }

        const modulesHtml = availableModules.map(mod => {
            const name = mod.module?.name || 'Unknown';
            if (['__vfs_meta__', '__config'].includes(name)) return '';
            return `
            <label class="settings-checkbox-row">
                <input type="checkbox" name="import-modules" value="${name}">
                <div style="flex:1; display:flex; justify-content:space-between;">
                    <span>📂 ${name}</span>
                    <span class="settings-badge settings-badge--warning" style="font-size:0.7em; background:#fee2e2; color:#991b1b;">覆盖</span>
                </div>
            </label>`;
        }).join('');

        // [新增] 策略选择区域
        const strategyHtml = `
            <div style="background:var(--st-bg-tertiary); padding:10px; border-radius:6px; margin-bottom:15px; border-left:4px solid var(--st-color-primary);">
                <h4 style="margin:0 0 8px 0;">合并策略</h4>
                <label class="settings-checkbox-row" style="margin:0;">
                    <input type="checkbox" id="chk-overwrite-mode">
                    <div>
                        <span style="font-weight:bold;">覆盖现有文件 (Overwrite)</span>
                        <p style="margin:0; font-size:0.8em; color:var(--st-text-secondary);">
                            默认：仅添加新文件，合并元数据和标签。<br>
                            勾选：如果文件路径相同，强制用导入文件的内容覆盖本地内容。
                        </p>
                    </div>
                </label>
            </div>
        `;

        const content = `
            <div class="settings-export-modal-content" style="padding: 0 5px;">
                ${strategyHtml}
                
                ${modulesHtml ? `
                <div style="margin-top:10px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <h4 style="margin:0;">📚 选择要导入的模块</h4>
                        <div>
                            <small class="settings-link-btn" onclick="document.querySelectorAll('input[name=import-modules]').forEach(c=>c.checked=true)">全选</small>
                            <small class="settings-link-btn" onclick="document.querySelectorAll('input[name=import-modules]').forEach(c=>c.checked=false)">清空</small>
                        </div>
                    </div>
                    <div class="settings-checklist-grid">${modulesHtml}</div>
                </div>` : ''}

                ${availableSettings.length > 0 ? `
                <div style="margin-top:20px;">
                    <h4 style="margin:0 0 5px 0;">⚙️ 系统配置</h4>
                    <p style="font-size:0.8em; color:var(--st-text-secondary);">配置项将始终合并/覆盖</p>
                    <div class="settings-checklist-grid">
                        ${availableSettings.map(k => `<label class="settings-checkbox-row"><input type="checkbox" name="import-settings" value="${k}" checked><span>${SETTINGS_LABELS[k]||k}</span></label>`).join('')}
                    </div>
                </div>` : ''}
            </div>
            <style>.settings-checklist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }</style>
        `;

        new Modal('导入数据', content, {
            confirmText: '开始导入',
            onConfirm: async () => {
                const sInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-settings"]:checked');
                const mInputs = document.querySelectorAll<HTMLInputElement>('input[name="import-modules"]:checked');
                const overwriteChk = document.querySelector<HTMLInputElement>('#chk-overwrite-mode');
                
                const keysToImport = Array.from(sInputs).map(i => i.value as keyof SettingsState);
                const modulesToImport = Array.from(mInputs).map(i => i.value);
                const isOverwrite = overwriteChk ? overwriteChk.checked : false;

                if (keysToImport.length === 0 && modulesToImport.length === 0) {
                    Toast.warning('未选择任何内容');
                    return false;
                }

                try {
                    // [重要] 传递 overwrite 选项给 Service
                    await this.service.importMixedData(json, keysToImport, modulesToImport, {
                        overwrite: isOverwrite,
                        mergeTags: true
                    });
                    Toast.success('导入成功，应用正在刷新...');
                    setTimeout(() => window.location.reload(), 1500);
                } catch (e) {
                    console.error(e);
                    Toast.error('导入错误');
                }
                return true;
            }
        }).show();
    }

    // --- Helper ---

    private resetApp() {
        Modal.confirm('⚠️ 恢复出厂设置', '此操作将永久删除所有数据。', async () => {
            try {
                await this.service.factoryReset();
                Toast.success('数据已清除，正在重启...');
                setTimeout(() => window.location.reload(), 1000);
            } catch (e) {
                console.error(e);
                Toast.error('重置失败');
            }
        });
    }

    private downloadJson(data: object | string, filename: string) {
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}
