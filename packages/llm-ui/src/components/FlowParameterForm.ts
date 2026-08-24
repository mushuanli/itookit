// @file: llm-ui/components/FlowParameterForm.ts
// Modal form that collects a workflow's declared runtime parameters.
// Renders one control per FlowParameter (defaults prefilled, overridable);
// validates required fields and returns null only on cancel.

import { escapeHTML, type FlowParameter, type JsonValue } from '@itookit/common';

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Show the parameter form; resolve to the collected values, or null on cancel. */
export function promptFlowParameters(
    parameters: FlowParameter[],
): Promise<Record<string, JsonValue> | null> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Run workflow</h2>
            ${parameters.map(parameterField).join('')}
            <p data-form-error class="dag-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="run">Create & Run</button></menu></form>`;
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => {
            if (dialog.returnValue !== 'run') { dialog.remove(); resolve(null); return; }
            try {
                const values = collectParameters(dialog, parameters);
                dialog.remove();
                resolve(values);
            } catch (error) {
                dialog.querySelector<HTMLElement>('[data-form-error]')!.textContent =
                    error instanceof Error ? error.message : 'Invalid value';
                dialog.showModal();
            }
        }, { once: true });
    });
}

function collectParameters(dialog: HTMLDialogElement, parameters: FlowParameter[]): Record<string, JsonValue> {
    const values: Record<string, JsonValue> = {};
    for (const param of parameters) {
        const field = dialog.querySelector<Field>(`[name="${escapeHTML(param.name)}"]`);
        if (!field) continue;
        if (param.required && isEmptyField(field)) throw new Error(`${param.name} is required`);
        values[param.name] = parseParameterValue(param.type, field);
    }
    return values;
}

function isEmptyField(field: Field): boolean {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') return false;
    return field.value.trim() === '';
}

function parameterField(param: FlowParameter): string {
    const name = escapeHTML(param.name);
    const description = param.description ? `<small>${escapeHTML(param.description)}</small>` : '';
    const required = param.required ? ' *' : '';
    if (param.type === 'boolean') {
        return `<label>${name}${required}${description}<input type="checkbox" name="${name}" ${param.default ? 'checked' : ''}></label>`;
    }
    const value = param.default !== undefined ? escapeHTML(stringifyDefault(param.default)) : '';
    if (param.type === 'number') {
        return `<label>${name}${required}${description}<input type="number" name="${name}" value="${value}"></label>`;
    }
    if (param.type === 'json') {
        return `<label>${name}${required}${description}<textarea name="${name}" rows="3">${value}</textarea></label>`;
    }
    return `<label>${name}${required}${description}<input type="text" name="${name}" value="${value}"></label>`;
}

function stringifyDefault(value: JsonValue): string {
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function parseParameterValue(type: FlowParameter['type'], field: Field): JsonValue {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') return field.checked;
    if (type === 'number') {
        const value = Number(field.value);
        if (!Number.isFinite(value)) throw new Error('Number required');
        return value;
    }
    if (type === 'json') return JSON.parse(field.value) as JsonValue;
    return field.value;
}
