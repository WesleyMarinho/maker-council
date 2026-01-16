/**
 * Spec Types for MAKER-Council
 * Specifications/PRD management
 */

export interface SpecSection {
    title: string;
    content: string;
    order: number;
}

export interface Spec {
    id: string;
    title: string;
    description: string;
    created_at: string;
    updated_at: string;
    sections: SpecSection[];
    metadata?: Record<string, unknown>;
}

export interface SpecsStore {
    specs: Spec[];
    current_spec_id: string | null;
}

export interface ParseSpecResult {
    success: boolean;
    spec?: Spec;
    error?: string;
}

export interface UpdateSpecInput {
    title?: string;
    description?: string;
    sections?: SpecSection[];
    metadata?: Record<string, unknown>;
}
