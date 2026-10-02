// @file: device-llm/constants/llm-configs/index.ts
// Unified aggregation point for all .llm external configs.
//
// To add a new .llm config:
//   1. Create llm-configs/<name>.llm (YAML definition)
//   2. Create llm-configs/<name>.ts (bridge module, exports provider + connections)
//   3. Import and add to the aggregated maps below

import type { LLMProvider, DefaultConnectionDef } from '@itookit/common';

// ─── Aggregated external providers (keyed by provider id) ────────────────────

export const externalProviders: Record<string, LLMProvider> = {};

// ─── Aggregated external connections ─────────────────────────────────────────

export const externalConnections: DefaultConnectionDef[] = [];
