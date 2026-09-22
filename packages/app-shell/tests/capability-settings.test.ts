// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AgentConfigEditor } from '../../llm-settings-ui/src/editors/AgentConfigEditor';
import { MCPSettingsEditor } from '../../llm-settings-ui/src/editors/MCPSettingsEditor';
import { Toast } from '@itookit/ui-common';
import type { AgentDefinition, MCPServer } from '@itookit/common';

const service = () => ({ getConnections: async () => [], getProviders: () => [],
    listSystemPrompts: async () => [], getMCPServers: async () => [], getSkills: async () => [] });
afterEach(() => vi.restoreAllMocks());

it('round trips policies and hidden configuration through the rendered Agent form', async () => {
    const host = document.createElement('div');
    const editor = new AgentConfigEditor(host, {}, service() as never);
    const agent: AgentDefinition = { id: 'restricted', name: 'Restricted', type: 'agent', version: 'v7',
        config: { connectionId: 'local', modelName: 'exact', systemPromptId: 'rules', maxHistoryLength: 0 },
        capabilityPolicy: { toolIds: [], skillIds: ['review'], mcpProfileIds: [] },
        memoryPolicy: { namespaceId: 'private', readScopes: [], writeScopes: [] },
        modelPolicy: { connectionId: 'local', thinking: true }, defaultContextPolicy: { tokenBudget: 9000 }, systemPrompt: 'policy' };
    await editor.init(host, JSON.stringify(agent));
    await vi.waitFor(() => expect(host.querySelector('[data-capability-editor]')).not.toBeNull());
    const saved = JSON.parse(editor.getText());
    expect(saved).toMatchObject({ version: 'v7', capabilityPolicy: agent.capabilityPolicy, memoryPolicy: agent.memoryPolicy,
        defaultContextPolicy: agent.defaultContextPolicy, modelPolicy: { thinking: true }, systemPrompt: 'policy',
        config: { modelName: 'exact', systemPromptId: 'rules', maxHistoryLength: 0 } });
});

it('writes MCP selection to the policy and preserves explicit empty tool grants', async () => {
    const host = document.createElement('div'); const svc = service();
    const editor = new AgentConfigEditor(host, {}, { ...svc, getMCPServers: async () => [{ id: 'mcp', name: 'MCP', transport: 'http' }] } as never);
    await editor.init(host, JSON.stringify({ id: 'agent', name: 'Agent', type: 'agent', config: {}, capabilityPolicy: { toolIds: [], mcpProfileIds: [] } }));
    await vi.waitFor(() => expect(host.querySelector('[name="mcpServers"]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('[name="mcpServers"]')!.checked = true;
    expect(JSON.parse(editor.getText()).capabilityPolicy).toEqual({ toolIds: [], skillIds: [], mcpProfileIds: ['mcp'] });
});

function mcpEditor(server: MCPServer, extra: Record<string, unknown> = {}) {
    const host = document.createElement('div');
    const saveMCPServer = vi.fn(async () => {});
    const editor = new MCPSettingsEditor(host, { getMCPServers: async () => [server], saveMCPServer, ...extra } as never, {});
    return { host, editor, saveMCPServer };
}

it('escapes imported fields in both list and detail, and saves seconds as milliseconds', async () => {
    const server: MCPServer = { id: 'mcp', name: '<em data-injected="true">& "name"</em>', transport: 'http',
        description: '</textarea><img data-injected>', endpoint: 'https://example.invalid/" data-injected="yes',
        tools: [{ name: '<b data-injected>tool</b>', description: '<img data-injected>' }], timeout: 30 };
    const { host, editor, saveMCPServer } = mcpEditor(server); await editor.render();
    expect(host.querySelector('[data-injected]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[name="header-name"]')!.value).toBe(server.name);
    expect(host.querySelector<HTMLInputElement>('[name="timeout"]')!.value).toBe('30');
    vi.spyOn(Toast, 'success').mockImplementation(() => {});
    host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
    await vi.waitFor(() => expect(saveMCPServer).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30000, timeoutUnit: 'ms', name: server.name })));
});

it('tests the unsaved draft through the protocol service and persists discovered metadata', async () => {
    const server: MCPServer = { id: 'mcp', name: 'MCP', transport: 'http', endpoint: 'https://old.invalid', timeout: 30000 };
    const catalog = { tools: [{ name: 'read', inputSchema: { type: 'object' } }], resources: [], prompts: [] };
    const testMCPServer = vi.fn(async () => catalog);
    const { host, editor, saveMCPServer } = mcpEditor(server, { testMCPServer }); await editor.render();
    host.querySelector<HTMLInputElement>('[name="endpoint"]')!.value = 'https://new.invalid';
    vi.spyOn(Toast, 'success').mockImplementation(() => {});
    host.querySelector<HTMLButtonElement>('[data-action="test"]')!.click();
    await vi.waitFor(() => expect(testMCPServer).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://new.invalid', timeout: 30000 })));
    await vi.waitFor(() => expect(saveMCPServer).toHaveBeenCalledWith(expect.objectContaining({ ...catalog, status: 'connected' })));
});

it('reports failed protocol handshakes without persisting a connected status', async () => {
    const testMCPServer = vi.fn(async () => { throw new Error('Not an MCP server'); });
    const error = vi.spyOn(Toast, 'error').mockImplementation(() => {});
    const { host, editor, saveMCPServer } = mcpEditor({ id: 'mcp', name: 'MCP', transport: 'stdio', command: 'node' }, { testMCPServer });
    await editor.render(); host.querySelector<HTMLButtonElement>('[data-action="test"]')!.click();
    await vi.waitFor(() => expect(error).toHaveBeenCalled()); expect(saveMCPServer).not.toHaveBeenCalled();
});

it('shows the required protocol and keeps legacy configurations visibly unsupported', async () => {
    const legacy = { id: 'old', name: 'Old', transport: 'sse' } as unknown as MCPServer;
    const { host, editor } = mcpEditor(legacy); await editor.render();
    const select = host.querySelector<HTMLSelectElement>('[name="transport"]')!;
    expect(select.value).toBe('sse'); expect(select.selectedOptions[0].disabled).toBe(true);
    expect(Array.from(select.options).filter(option => !option.disabled).map(option => option.value)).not.toContain('sse');
    expect(host.textContent).toContain('2026-07-28');
});
