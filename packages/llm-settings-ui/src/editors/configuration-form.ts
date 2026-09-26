import { t } from '@itookit/common';
import { Modal, Toast } from '@itookit/ui-common';

interface FormOptions { width: string; confirmText: string; onConfirm(): Promise<void | false> }
/** Reuse the same form and validation in a dialog or a selected-resource editor. */
export function showConfigurationForm(container: HTMLElement, title: string, content: string, options: FormOptions, inline: boolean): void {
    if (!inline) { new Modal(title, content, options).show(); return; }
    const page = document.createElement('section'); page.className = 'settings-page';
    const header = document.createElement('div'); header.className = 'settings-page__header';
    const heading = document.createElement('h2'); heading.className = 'settings-page__title'; heading.textContent = title;
    const actions = document.createElement('div'); actions.className = 'settings-page__actions';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'settings-btn settings-btn--primary'; save.textContent = t('action.save');
    const body = document.createElement('div'); body.innerHTML = content;
    const submit = async () => {
        if (save.disabled) return; save.disabled = true;
        try { await options.onConfirm(); } catch (error) { Toast.error(String(error)); } finally { save.disabled = false; }
    };
    save.onclick = () => { void submit(); };
    body.querySelector('form')?.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    actions.append(save); header.append(heading, actions); page.append(header, body); container.replaceChildren(page);
}

export function addConfigurationAction(container: HTMLElement, label: string, run: () => void): void {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn settings-btn--secondary';
    button.textContent = label; button.onclick = run; container.querySelector('.settings-page__actions')?.append(button);
}

export function addConfigurationEnabled(container: HTMLElement, enabled: boolean): void {
    const label = document.createElement('label'); label.className = 'settings-form__group';
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'enabled'; input.checked = enabled;
    label.append(input, ' ', t('toolbox.enabled')); container.querySelector('form')?.prepend(label);
}
