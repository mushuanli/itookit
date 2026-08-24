// @file: llm-ui/components/dag/FlowSettingsDialog.ts
// Flow-level settings modal: named connection slots (bound to global LLM
// connections + one default) and declared runtime parameters with defaults.

import type { FlowConnection, FlowParameter, JsonValue } from '@itookit/common';
import { escapeHTML } from '@itookit/common';

export interface FlowSettingsOptions {
    connections: FlowConnection[];
    defaultConnection?: string;
    parameters: FlowParameter[];
    /** Global LLM connections available to bind a slot to. */
    availableConnections: Array<{ id: string; name: string }>;
}

export interface FlowSettingsResult {
    connections: FlowConnection[];
    defaultConnection?: string;
    parameters: FlowParameter[];
}

const PARAM_TYPES: FlowParameter['type'][] = ['string', 'number', 'boolean', 'json'];

/** Open the flow settings modal; resolve to the edited settings or null on cancel. */
export function openFlowSettings(options: FlowSettingsOptions): Promise<FlowSettingsResult | null> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog dag-settings';
        dialog.innerHTML = `<form method="dialog">
            <h2>Flow settings</h2>
            <fieldset>
                <legend>Connections</legend>
                <div data-connections>${options.connections.map(connection => connectionRow(connection, options.availableConnections, options.defaultConnection)).join('')}</div>
                <button type="button" data-add-connection class="dag-settings__add">Add connection</button>
            </fieldset>
            <fieldset>
                <legend>Parameters</legend>
                <div data-parameters>${options.parameters.map(parameterRow).join('')}</div>
                <button type="button" data-add-parameter class="dag-settings__add">Add parameter</button>
            </fieldset>
            <p data-dialog-error class="dag-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="save">Save settings</button></menu>
        </form>`;
        document.body.append(dialog);
        bindRowControls(dialog, options);
        dialog.showModal();
        dialog.addEventListener('close', () => {
            if (dialog.returnValue !== 'save') { dialog.remove(); resolve(null); return; }
            try {
                const result = readSettings(dialog);
                dialog.remove();
                resolve(result);
            } catch (error) {
                dialog.querySelector<HTMLElement>('[data-dialog-error]')!.textContent =
                    error instanceof Error ? error.message : 'Invalid settings';
                dialog.showModal();
            }
        }, { once: true });
    });
}

function connectionRow(
    connection: FlowConnection,
    available: Array<{ id: string; name: string }>,
    defaultConnection: string | undefined,
): string {
    const isDefault = connection.name === defaultConnection || (!defaultConnection && connection.name === 'default');
    return `<div class="dag-setting-row" data-conn-row>
        <label class="dag-settings__default" title="Default"><input type="radio" name="dag-default-conn" ${isDefault ? 'checked' : ''}>default</label>
        <input data-conn-name placeholder="name" value="${escapeHTML(connection.name)}">
        <select data-conn-id>${available.map(item =>
            `<option value="${escapeHTML(item.id)}" ${item.id === connection.connectionId ? 'selected' : ''}>${escapeHTML(item.name)}</option>`,
        ).join('')}</select>
        <input data-conn-desc placeholder="description" value="${escapeHTML(connection.description ?? '')}">
        <button type="button" data-remove-conn>×</button>
    </div>`;
}

function parameterRow(parameter?: FlowParameter): string {
    const param = parameter ?? { name: '', type: 'string' as const };
    const value = param.default !== undefined ? stringifyDefault(param.default, param.type) : '';
    return `<div class="dag-setting-row" data-param-row>
        <input data-param-name placeholder="name" value="${escapeHTML(param.name)}">
        <select data-param-type>${PARAM_TYPES.map(type =>
            `<option ${type === param.type ? 'selected' : ''}>${type}</option>`,
        ).join('')}</select>
        <input data-param-default placeholder="default" value="${escapeHTML(value)}">
        <label class="dag-settings__check" title="Required"><input type="checkbox" data-param-required ${param.required ? 'checked' : ''}>required</label>
        <input data-param-desc placeholder="description" value="${escapeHTML(param.description ?? '')}">
        <button type="button" data-remove-param>×</button>
    </div>`;
}

function bindRowControls(dialog: HTMLDialogElement, options: FlowSettingsOptions): void {
    dialog.querySelector('[data-add-connection]')?.addEventListener('click', () => {
        const container = dialog.querySelector<HTMLElement>('[data-connections]')!;
        container.insertAdjacentHTML('beforeend', connectionRow(
            { name: '', connectionId: options.availableConnections[0]?.id ?? 'default' },
            options.availableConnections,
            options.defaultConnection,
        ));
    });
    dialog.querySelector('[data-add-parameter]')?.addEventListener('click', () => {
        const container = dialog.querySelector<HTMLElement>('[data-parameters]')!;
        container.insertAdjacentHTML('beforeend', parameterRow());
    });
    dialog.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-remove-conn]')) {
            target.closest('[data-conn-row]')?.remove();
        } else if (target.closest('[data-remove-param]')) {
            target.closest('[data-param-row]')?.remove();
        }
    });
}

function readSettings(dialog: HTMLDialogElement): FlowSettingsResult {
    const connections = [...dialog.querySelectorAll<HTMLElement>('[data-conn-row]')].map(row => {
        const name = readInput(row, '[data-conn-name]').trim();
        const connectionId = readInput(row, '[data-conn-id]');
        const description = readInput(row, '[data-conn-desc]').trim();
        if (!name) throw new Error('Every connection needs a name');
        if (!connectionId) throw new Error(`Connection ${name} needs a global connection`);
        return { name, connectionId, ...(description ? { description } : {}) };
    });
    if (new Set(connections.map(item => item.name)).size !== connections.length) {
        throw new Error('Connection names must be unique');
    }
    const defaultRow = [...dialog.querySelectorAll<HTMLElement>('[data-conn-row]')]
        .find(row => row.querySelector<HTMLInputElement>('[data-conn-default], input[type="radio"]')?.checked);
    const defaultConnection = defaultRow
        ? readInput(defaultRow, '[data-conn-name]').trim()
        : connections[0]?.name;

    const parameters = [...dialog.querySelectorAll<HTMLElement>('[data-param-row]')].map(row => {
        const name = readInput(row, '[data-param-name]').trim();
        const type = readInput(row, '[data-param-type]') as FlowParameter['type'];
        const required = row.querySelector<HTMLInputElement>('[data-param-required]')?.checked ?? false;
        const description = readInput(row, '[data-param-desc]').trim();
        if (!name) throw new Error('Every parameter needs a name');
        const raw = readInput(row, '[data-param-default]');
        const result: FlowParameter = { name, type, ...(description ? { description } : {}) };
        if (required) result.required = true;
        if (raw !== '') result.default = parseDefault(raw, type);
        return result;
    });
    if (new Set(parameters.map(item => item.name)).size !== parameters.length) {
        throw new Error('Parameter names must be unique');
    }
    return { connections, ...(defaultConnection ? { defaultConnection } : {}), parameters };
}

function readInput(row: HTMLElement, selector: string): string {
    const element = row.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    return element?.value ?? '';
}

function stringifyDefault(value: JsonValue, type: FlowParameter['type']): string {
    if (type === 'json') return JSON.stringify(value);
    if (type === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

function parseDefault(raw: string, type: FlowParameter['type']): JsonValue {
    if (type === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`Default for a number parameter must be numeric`);
        return value;
    }
    if (type === 'boolean') return raw === 'true';
    if (type === 'json') return JSON.parse(raw) as JsonValue;
    return raw;
}
