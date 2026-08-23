// @file: llm-ui/components/FlowParameterForm.ts
// Modal form that collects a workflow's declared runtime parameters.
// Renders one control per FlowParameter; returns null when the user cancels.

import { escapeHTML, type FlowParameter, type JsonValue } from '@itookit/common';

/** Show the parameter form; resolve to the collected values, or null on cancel. */
export function promptFlowParameters(
    parameters: FlowParameter[],
): Promise<Record<string, JsonValue> | null> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Run workflow</h2>
            ${parameters.map(parameterField).join('')}
            <menu><button value="cancel">Cancel</button><button value="run">Create & Run</button></menu></form>`;
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => {
            if (dialog.returnValue !== 'run') { dialog.remove(); resolve(null); return; }
            try {
                const values: Record<string, JsonValue> = {};
                for (const param of parameters) {
                    const field = dialog.querySelector<HTMLInputElement>(`[name="${escapeHTML(param.name)}"]`);
                    if (field) values[param.name] = parseParameterValue(param.type, field);
                }
                dialog.remove();
                resolve(values);
            } catch {
                dialog.remove();
                resolve(null);
            }
        }, { once: true });
    });
}

function parameterField(param: FlowParameter): string {
    const name = escapeHTML(param.name);
    const description = param.description ? `<small>${escapeHTML(param.description)}</small>` : '';
    const required = param.required ? ' *' : '';
    const value = param.default !== undefined ? escapeHTML(String(param.default)) : '';
    if (param.type === 'boolean') {
        return `<label>${name}${required}${description}<input type="checkbox" name="${name}" ${param.default ? 'checked' : ''}></label>`;
    }
    if (param.type === 'number') {
        return `<label>${name}${required}${description}<input type="number" name="${name}" value="${value}"></label>`;
    }
    if (param.type === 'json') {
        return `<label>${name}${required}${description}<textarea name="${name}" rows="3">${value}</textarea></label>`;
    }
    return `<label>${name}${required}${description}<input type="text" name="${name}" value="${value}"></label>`;
}

function parseParameterValue(type: FlowParameter['type'], field: HTMLInputElement): JsonValue {
    if (type === 'boolean') return field.checked;
    if (type === 'number') {
        const value = Number(field.value);
        if (!Number.isFinite(value)) throw new Error('Number required');
        return value;
    }
    if (type === 'json') return JSON.parse(field.value) as JsonValue;
    return field.value;
}
