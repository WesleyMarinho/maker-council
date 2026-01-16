/**
 * Specs Module for MAKER-Council
 * Handles specification/PRD parsing and management
 */

import * as fs from 'fs';
import * as path from 'path';
import { Spec, SpecSection, SpecsStore, ParseSpecResult, UpdateSpecInput } from './types/specs.js';
import { createMessage, generateRequestId } from './logic.js';
import { config } from './config.js';

const MAKER_DIR = '.maker';
const SPECS_FILE = 'specs.json';

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

function getMakerDir(workspacePath: string = process.cwd()): string {
    return path.join(workspacePath, MAKER_DIR);
}

function getSpecsPath(workspacePath: string = process.cwd()): string {
    return path.join(getMakerDir(workspacePath), SPECS_FILE);
}

function ensureMakerDir(workspacePath: string = process.cwd()): void {
    const dir = getMakerDir(workspacePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export function loadSpecs(workspacePath: string = process.cwd()): SpecsStore {
    const specsPath = getSpecsPath(workspacePath);

    if (!fs.existsSync(specsPath)) {
        return { specs: [], current_spec_id: null };
    }

    try {
        const data = fs.readFileSync(specsPath, 'utf-8');
        return JSON.parse(data) as SpecsStore;
    } catch (error) {
        console.error('[SPECS] Failed to load specs:', error);
        return { specs: [], current_spec_id: null };
    }
}

export function saveSpecs(store: SpecsStore, workspacePath: string = process.cwd()): void {
    ensureMakerDir(workspacePath);
    const specsPath = getSpecsPath(workspacePath);
    fs.writeFileSync(specsPath, JSON.stringify(store, null, 2), 'utf-8');
}

// ============================================================================
// SPEC PARSING PROMPT
// ============================================================================

const PARSE_SPEC_PROMPT = `You are an expert at analyzing Product Requirements Documents (PRD) and specifications.
Your task is to extract and structure the key information from the provided document.

OUTPUT FORMAT (JSON only, no markdown):
{
  "title": "Brief title for this specification",
  "description": "One paragraph summary of what this spec is about",
  "sections": [
    {
      "title": "Section name",
      "content": "Section content summarized",
      "order": 1
    }
  ]
}

IMPORTANT:
- Extract the most important information
- Keep sections concise but complete
- Identify goals, requirements, constraints, and success criteria
- Respond ONLY with valid JSON, no markdown code blocks`;

// ============================================================================
// SPEC OPERATIONS
// ============================================================================

export async function parseSpec(content: string, workspacePath: string = process.cwd()): Promise<ParseSpecResult> {
    try {
        const { text } = await createMessage(
            config.judgeModel,
            PARSE_SPEC_PROMPT,
            content,
            0.2,
            2048
        );

        // Clean potential markdown code blocks
        let cleanJson = text.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleanJson);

        const now = new Date().toISOString();
        const spec: Spec = {
            id: `spec-${generateRequestId().slice(0, 8)}`,
            title: parsed.title || 'Untitled Spec',
            description: parsed.description || '',
            created_at: now,
            updated_at: now,
            sections: (parsed.sections || []).map((s: any, i: number) => ({
                title: s.title || `Section ${i + 1}`,
                content: s.content || '',
                order: s.order || i + 1
            }))
        };

        // Save to store
        const store = loadSpecs(workspacePath);
        store.specs.push(spec);
        store.current_spec_id = spec.id;
        saveSpecs(store, workspacePath);

        return { success: true, spec };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to parse spec: ${errorMsg}` };
    }
}

export function getSpec(id?: string, workspacePath: string = process.cwd()): Spec | null {
    const store = loadSpecs(workspacePath);

    if (store.specs.length === 0) {
        return null;
    }

    if (id) {
        return store.specs.find(s => s.id === id) || null;
    }

    // Return current or most recent
    if (store.current_spec_id) {
        const current = store.specs.find(s => s.id === store.current_spec_id);
        if (current) return current;
    }

    return store.specs[store.specs.length - 1];
}

export function updateSpec(id: string, updates: UpdateSpecInput, workspacePath: string = process.cwd()): Spec | null {
    const store = loadSpecs(workspacePath);
    const index = store.specs.findIndex(s => s.id === id);

    if (index === -1) {
        return null;
    }

    const spec = store.specs[index];

    if (updates.title !== undefined) spec.title = updates.title;
    if (updates.description !== undefined) spec.description = updates.description;
    if (updates.sections !== undefined) spec.sections = updates.sections;
    if (updates.metadata !== undefined) spec.metadata = { ...spec.metadata, ...updates.metadata };

    spec.updated_at = new Date().toISOString();

    store.specs[index] = spec;
    saveSpecs(store, workspacePath);

    return spec;
}

export function listSpecs(workspacePath: string = process.cwd()): Spec[] {
    const store = loadSpecs(workspacePath);
    return store.specs;
}

export function deleteSpec(id: string, workspacePath: string = process.cwd()): boolean {
    const store = loadSpecs(workspacePath);
    const index = store.specs.findIndex(s => s.id === id);

    if (index === -1) {
        return false;
    }

    store.specs.splice(index, 1);

    if (store.current_spec_id === id) {
        store.current_spec_id = store.specs.length > 0 ? store.specs[store.specs.length - 1].id : null;
    }

    saveSpecs(store, workspacePath);
    return true;
}
