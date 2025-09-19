// src/settings/store/settingsStore.js

import * as dataService from '../../services/dataService.js';
import * as tagService from '../../services/tagService.js';
import * as taskListService from '../../services/taskListService.js'; // [NEW] Import taskListService
import { exportDatabase, importDatabase } from '../../services/dbService.js';
import { db } from '../../common/db.js';

class SettingsStore {
    constructor() {
        this.state = {
            // Data state loaded from services
            apiConfigs: [],
            agents: [],
            allTags: [], // [NEW] For global tag management
            taskLists: [], // [NEW]

            settings: {
                theme: 'light',
                autoSaveInterval: 5,
            },

            // UI state for managing the view
            activeItemId: 'general',
            activeItemType: 'general',
            isCreating: false,
            isLoading: false,
            isSaving: false,
        };
        this.listeners = new Set();
    }

    getState() {
        return { ...this.state };
    }

    setState(updates) {
        const oldState = { ...this.state };
        const hasChanged = Object.keys(updates).some(key => this.state[key] !== updates[key]);
        if (!hasChanged && Object.keys(updates).length > 0) return;

        this.state = { ...this.state, ...updates };
        this.notify(oldState, this.state);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(oldState, newState) {
        this.listeners.forEach(listener => listener(newState, oldState));
    }

    // ======================================================
    //                   ACTIONS (业务逻辑)
    // ======================================================

    /**
     * [修改] 初始化函数现在接收外部注入的数据。
     * @param {object} initialData - 包含 apiConfigs, agents 等的对象。
     */
    async initialize(initialData) {
        const theme = localStorage.getItem('app-theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
        
        const autoSaveIntervalSetting = await db.global_appState.get('autoSaveInterval');
        const autoSaveInterval = autoSaveIntervalSetting ? autoSaveIntervalSetting.value : 5;
        
        const [tags, taskLists] = await Promise.all([
            tagService.getAllTags(),
            taskListService.getAllTaskLists()
        ]);

        this.setState({
            apiConfigs: initialData.apiConfigs || [],
            agents: initialData.agents || [],
            allTags: tags, // [NEW] Set tags in state
            taskLists: taskLists, // [NEW]
            settings: {
                theme: theme,
                autoSaveInterval: autoSaveInterval,
            }
        });
    }

    selectItem(itemId, itemType) {
        this.setState({
            activeItemId: itemId,
            activeItemType: itemType,
            isCreating: false
        });
    }

    startCreatingItem(itemType) {
        this.setState({
            activeItemId: null,
            activeItemType: itemType,
            isCreating: true
        });
    }

    async saveCurrentItem(formData) {
        this.setState({ isSaving: true });
        try {
            const { activeItemType, isCreating } = this.state;
            let savedItem;

            if (activeItemType === 'apiConfig') {
                if (isCreating) {
                    savedItem = await dataService.addApiConfig(formData);
                } else {
                    savedItem = await dataService.updateApiConfig(formData.id, formData);
                }
            } else if (activeItemType === 'agent') {
                 // [NEW] Also save new tags to global store
                if (formData.tags && formData.tags.length > 0) {
                    await tagService.addTags(formData.tags);
                }
                if (isCreating) {
                    savedItem = await dataService.addAgent(formData);
                } else {
                    savedItem = await dataService.updateAgent(formData.id, formData);
                }
            }

            // [新增] 保存成功后，派发全局事件通知其他模块
            window.dispatchEvent(new CustomEvent('app:sharedDataUpdated'));

            if (savedItem) {
                this.selectItem(savedItem.id, activeItemType);
            }

        } catch (error) {
            console.error("Save failed:", error);
            alert(`保存失败: ${error.message}`);
        } finally {
            this.setState({ isSaving: false });
        }
    }

    // [NEW] Action for partial updates, enabling auto-save for tags
    async updateAgentPartial(agentId, updates) {
        // No need to set isSaving for this quick background task
        try {
            // Also save any new tags to the global store
            if (updates.tags && updates.tags.length > 0) {
                await tagService.addTags(updates.tags);
            }
            await dataService.updateAgent(agentId, updates);
            // This event is crucial. It tells the main app to reload shared data,
            // which will then cause this store to re-initialize with fresh data,
            // ensuring consistency.
            window.dispatchEvent(new CustomEvent('app:sharedDataUpdated'));
        } catch (error) {
            console.error("Partial agent update failed:", error);
            alert(`标签更新失败: ${error.message}`);
            // Optional: Implement logic to revert the UI change on failure
        }
    }

    async deleteItem(itemId, itemType) {
        if (!confirm("确定要删除此配置吗？")) return;
        this.setState({ isLoading: true });
        try {
            if (itemType === 'apiConfig') {
                await dataService.deleteApiConfig(itemId);
            } else if (itemType === 'agent') {
                await dataService.deleteAgent(itemId);
            }
            
            // [新增] 删除成功后，派发全局事件
            window.dispatchEvent(new CustomEvent('app:sharedDataUpdated'));
            
            this.selectItem('general', 'general');
        } catch (error) {
            console.error("Delete failed:", error);
            alert(`删除失败: ${error.message}`);
        } finally {
            this.setState({ isLoading: false });
        }
    }
    
    // --- [NEW] Task List Management Actions ---
    async addTaskList(name) {
        if (!name || !name.trim()) return;
        try {
            await taskListService.addTaskList(name);
            const newTaskLists = await taskListService.getAllTaskLists();
            this.setState({ taskLists: newTaskLists });
        } catch (error) {
            console.error("Failed to add task list:", error);
            alert(`添加失败: ${error.message}`);
        }
    }

    async renameTaskList(id, newName) {
        if (!newName || !newName.trim()) return;
        try {
            await taskListService.renameTaskList(id, newName);
            const newTaskLists = await taskListService.getAllTaskLists();
            this.setState({ taskLists: newTaskLists });
        } catch (error) {
            console.error("Failed to rename task list:", error);
            alert(`重命名失败: ${error.message}`);
        }
    }

    async deleteTaskList(id) {
        try {
            await taskListService.deleteTaskList(id);
            const newTaskLists = await taskListService.getAllTaskLists();
            this.setState({ taskLists: newTaskLists });
            // Notify task module to update if it's initialized
            window.dispatchEvent(new CustomEvent('app:sharedDataUpdated'));
        } catch (error) {
            console.error("Failed to delete task list:", error);
            alert(`删除失败: ${error.message}`);
        }
    }

    // --- Tag Management Actions (Unchanged) ---
    async addTag(tagName) {
        if (!tagName || this.state.allTags.includes(tagName)) {
            alert(`标签 "${tagName}" 已存在或无效。`);
            return;
        };
        await tagService.addTags(tagName);
        const newTags = await tagService.getAllTags();
        this.setState({ allTags: newTags });
    }

    async deleteTag(tagName) {
        const result = await tagService.deleteTag(tagName);
        if (!result.success) {
            alert(result.message);
            return;
        }
        const newTags = await tagService.getAllTags();
        this.setState({ allTags: newTags });
    }

    setTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName || '');
        localStorage.setItem('app-theme', themeName);
        this.setState({ settings: { ...this.state.settings, theme: themeName } });
    }

    async setAutoSaveInterval(interval) {
        const newInterval = parseInt(interval, 10);
        if (!isNaN(newInterval) && newInterval >= 0) {
            this.setState({ settings: { ...this.state.settings, autoSaveInterval: newInterval } });
            await dataService.updateGlobalSetting('autoSaveInterval', newInterval);
            // 触发全局事件，通知 main.js 更新定时器
            window.dispatchEvent(new CustomEvent('app:settingChanged', { 
                detail: { key: 'autoSaveInterval', value: newInterval }
            }));
        }
    }

    async exportDb() {
        try {
            const data = await exportDatabase();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `smart-suite-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert(`导出失败: ${error.message}`);
        }
    }

    async importDb(file) {
        if (!file) return;
        if (!confirm("警告！导入将覆盖所有现有数据。确定继续吗？")) return;
        try {
            const data = JSON.parse(await file.text());
            await importDatabase(data);
            alert("数据导入成功！应用即将刷新。");
            window.location.reload();
        } catch (error) {
            alert(`导入失败: ${error.message}`);
        }
    }
}

export const settingsStore = new SettingsStore();
