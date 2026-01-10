// @file: app-settings/editors/AboutSettingsEditor.ts
import { BaseSettingsEditor} from '@itookit/common';
import { SettingsService } from '../services/SettingsService';
1
export class AboutSettingsEditor extends BaseSettingsEditor<SettingsService> {
    render() {
        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-about__header">
                    <div class="settings-about__logo">🤖</div>
                    <h1 class="settings-page__title">AI Workspace</h1>
                    <p class="settings-page__description">v1.0.0</p>
                </div>

                <div class="settings-about__grid">
                    <div class="settings-info-card">
                        <h3>技术栈</h3>
                        <ul class="settings-feature-list">
                            <li>TypeScript</li>
                            <li>VFS Core (IndexedDB)</li>
                            <li>Memory Manager</li>
                        </ul>
                    </div>
                    <div class="settings-info-card">
                        <h3>关于</h3>
                        <p class="settings-page__description">
                            这是一个完全本地化的 AI 工作区，所有数据存储在浏览器中。
                        </p>
                    </div>
                </div>
            </div>
        `;
    }
}
