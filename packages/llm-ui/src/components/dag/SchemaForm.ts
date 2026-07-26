import type { FormLayout, JsonValue } from '@itookit/common';
import { escapeHTML } from '@itookit/common';

interface JsonSchema {
    type?: string;
    title?: string;
    description?: string;
    enum?: JsonValue[];
    required?: string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
}

export class SchemaForm {
    constructor(
        private readonly root: HTMLElement,
        private readonly schema: JsonValue,
        private value: JsonValue,
        private readonly layout?: FormLayout,
    ) {}

    render(): void {
        this.root.innerHTML = renderRoot(asSchema(this.schema), this.value, this.layout);
    }

    read(): { value?: JsonValue; errors: string[] } {
        const errors: string[] = [];
        let value = structuredClone(this.value);
        for (const field of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-schema-path]')) {
            try {
                value = setPath(value, field.dataset.schemaPath!, readField(field));
            } catch (error) {
                errors.push(error instanceof Error ? error.message : 'Invalid field value');
            }
        }
        errors.push(...validateSchema(asSchema(this.schema), value));
        if (errors.length) return { errors };
        this.value = value;
        return { value, errors };
    }
}

function renderRoot(schema: JsonSchema, value: JsonValue, layout?: FormLayout): string {
    if (schema.type !== 'object' || !layout) {
        return renderSchema(schema, value, '$', true);
    }
    const record = isRecord(value) ? value : {};
    const configured = new Set(layout.sections.flatMap(section => section.fields));
    const sections = layout.sections.map(section =>
        renderSection(schema, record, section.title, section.fields),
    );
    const remaining = Object.keys(schema.properties ?? {})
        .filter(field => !configured.has(field));
    if (remaining.length) sections.push(renderSection(schema, record, undefined, remaining));
    return sections.join('');
}

function renderSection(
    schema: JsonSchema,
    value: Record<string, JsonValue>,
    title: string | undefined,
    fields: string[],
): string {
    const body = fields.map(field => renderProperty(schema, value, field)).join('');
    return title
        ? `<fieldset><legend>${escapeHTML(title)}</legend>${body}</fieldset>`
        : body;
}

export function validateSchema(schema: JsonSchema, value: JsonValue, path = '$'): string[] {
    const errors: string[] = [];
    if (schema.type && !matchesType(schema.type, value)) errors.push(`${path} must be ${schema.type}`);
    if (schema.enum && !schema.enum.some(item => same(item, value))) errors.push(`${path} is not an allowed value`);
    if (schema.type === 'object' && isRecord(value)) validateProperties(schema, value, path, errors);
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
        value.forEach((item, index) => errors.push(...validateSchema(schema.items!, item, `${path}[${index}]`)));
    }
    return errors;
}

function renderSchema(schema: JsonSchema, value: JsonValue, path: string, root = false): string {
    if (schema.type === 'object' && root) return renderProperties(schema, value, path);
    const label = escapeHTML(schema.title ?? path.split('.').pop() ?? path);
    const description = schema.description ? `<small>${escapeHTML(schema.description)}</small>` : '';
    return `<label class="dag-schema-field"><span>${label}</span>${description}${renderControl(schema, value, path)}</label>`;
}

function renderProperties(schema: JsonSchema, value: JsonValue, path: string): string {
    const record = isRecord(value) ? value : {};
    return Object.keys(schema.properties ?? {})
        .map(key => renderProperty(schema, record, key, path))
        .join('');
}

function renderProperty(
    schema: JsonSchema,
    value: Record<string, JsonValue>,
    key: string,
    path = '$',
): string {
    const child = schema.properties?.[key];
    if (!child) return '';
    const required = schema.required?.includes(key) ? ' *' : '';
    const fieldSchema = { ...child, title: `${child.title ?? key}${required}` };
    return renderSchema(
        fieldSchema,
        (value[key] ?? defaultValue(child)) as JsonValue,
        `${path}.${key}`,
    );
}

function renderControl(schema: JsonSchema, value: JsonValue, path: string): string {
    const encodedPath = escapeHTML(path);
    if (schema.enum) {
        return `<select data-schema-path="${encodedPath}">${schema.enum.map(item =>
            `<option value="${escapeHTML(JSON.stringify(item))}" ${same(item, value) ? 'selected' : ''}>${escapeHTML(String(item))}</option>`,
        ).join('')}</select>`;
    }
    if (schema.type === 'boolean') {
        return `<input data-schema-path="${encodedPath}" data-schema-type="boolean" type="checkbox" ${value ? 'checked' : ''}>`;
    }
    if (schema.type === 'number' || schema.type === 'integer') {
        return `<input data-schema-path="${encodedPath}" data-schema-type="${schema.type}" type="number" value="${escapeHTML(String(value ?? 0))}">`;
    }
    if (schema.type === 'object' || schema.type === 'array' || !schema.type) {
        return `<textarea data-schema-path="${encodedPath}" data-schema-type="json" rows="5">${escapeHTML(JSON.stringify(value ?? defaultValue(schema), null, 2))}</textarea>`;
    }
    return `<input data-schema-path="${encodedPath}" type="text" value="${escapeHTML(String(value ?? ''))}">`;
}

function readField(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): JsonValue {
    if (field instanceof HTMLInputElement && field.dataset.schemaType === 'boolean') return field.checked;
    if (field.dataset.schemaType === 'number' || field.dataset.schemaType === 'integer') {
        const value = Number(field.value);
        if (!Number.isFinite(value)) throw new Error(`${field.dataset.schemaPath} must be a number`);
        return value;
    }
    if (field.dataset.schemaType === 'json' || field instanceof HTMLSelectElement) {
        try {
            return JSON.parse(field.value) as JsonValue;
        } catch {
            throw new Error(`${field.dataset.schemaPath} contains invalid JSON`);
        }
    }
    return field.value;
}

function setPath(root: JsonValue, path: string, value: JsonValue): JsonValue {
    if (path === '$') return value;
    const result = isRecord(root) ? structuredClone(root) : {};
    const parts = path.replace(/^\$\./, '').split('.');
    if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) {
        throw new Error(`${path} is not a safe configuration path`);
    }
    let current: Record<string, JsonValue> = result;
    parts.forEach((part, index) => {
        if (index === parts.length - 1) current[part] = value;
        else {
            if (!isRecord(current[part])) current[part] = {};
            current = current[part] as Record<string, JsonValue>;
        }
    });
    return result;
}

function validateProperties(schema: JsonSchema, value: Record<string, JsonValue>, path: string, errors: string[]): void {
    for (const required of schema.required ?? []) {
        if (!(required in value) || value[required] === '') errors.push(`${path}.${required} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in value) errors.push(...validateSchema(child, value[key], `${path}.${key}`));
    }
}

function defaultValue(schema: JsonSchema): JsonValue {
    if (schema.type === 'object') return {};
    if (schema.type === 'array') return [];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return 0;
    return '';
}

function asSchema(value: JsonValue): JsonSchema {
    return isRecord(value) ? value as JsonSchema : {};
}

function matchesType(type: string, value: JsonValue): boolean {
    if (type === 'object') return isRecord(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'string') return typeof value === 'string';
    return true;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function same(left: JsonValue, right: JsonValue): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
