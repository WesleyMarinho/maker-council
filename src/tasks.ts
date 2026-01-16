/**
 * Tasks Module for MAKER-Council
 * Task management compatible with task-master format
 */

import * as fs from 'fs';
import * as path from 'path';
import { Task, Subtask, TasksStore, TaskStatus, TaskPriority, AddTaskInput, ExpandTaskResult } from './types/tasks.js';
import { createMessage, generateRequestId } from './logic.js';
import { config } from './config.js';

const MAKER_DIR = '.maker';
const TASKS_FILE = 'tasks.json';

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

function getMakerDir(workspacePath: string = process.cwd()): string {
    return path.join(workspacePath, MAKER_DIR);
}

function getTasksPath(workspacePath: string = process.cwd()): string {
    return path.join(getMakerDir(workspacePath), TASKS_FILE);
}

function ensureMakerDir(workspacePath: string = process.cwd()): void {
    const dir = getMakerDir(workspacePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export function loadTasks(workspacePath: string = process.cwd()): TasksStore {
    const tasksPath = getTasksPath(workspacePath);

    if (!fs.existsSync(tasksPath)) {
        return { tasks: [], next_id: 1 };
    }

    try {
        const data = fs.readFileSync(tasksPath, 'utf-8');
        return JSON.parse(data) as TasksStore;
    } catch (error) {
        console.error('[TASKS] Failed to load tasks:', error);
        return { tasks: [], next_id: 1 };
    }
}

export function saveTasks(store: TasksStore, workspacePath: string = process.cwd()): void {
    ensureMakerDir(workspacePath);
    const tasksPath = getTasksPath(workspacePath);
    fs.writeFileSync(tasksPath, JSON.stringify(store, null, 2), 'utf-8');
}

// ============================================================================
// EXPAND TASK PROMPT
// ============================================================================

const EXPAND_TASK_PROMPT = `You are an expert at breaking down tasks into smaller, actionable subtasks.
Given a task, create 3-7 specific subtasks that together accomplish the main task.

OUTPUT FORMAT (JSON only, no markdown):
{
  "subtasks": [
    {
      "title": "Brief subtask title",
      "description": "What needs to be done",
      "details": "Implementation notes if any"
    }
  ]
}

RULES:
- Each subtask should be atomic and verifiable
- Order subtasks logically (dependencies first)
- Be specific, not vague
- Respond ONLY with valid JSON, no markdown code blocks`;

// ============================================================================
// TASK OPERATIONS
// ============================================================================

export function listTasks(status?: TaskStatus, workspacePath: string = process.cwd()): Task[] {
    const store = loadTasks(workspacePath);

    if (status) {
        return store.tasks.filter(t => t.status === status);
    }

    return store.tasks;
}

export function getTask(id: number, workspacePath: string = process.cwd()): Task | null {
    const store = loadTasks(workspacePath);
    return store.tasks.find(t => t.id === id) || null;
}

export function nextTask(workspacePath: string = process.cwd()): Task | null {
    const store = loadTasks(workspacePath);

    // Find tasks that are pending and have no pending dependencies
    const pendingTasks = store.tasks.filter(t => t.status === 'pending');

    for (const task of pendingTasks) {
        const hasBlockingDeps = task.dependencies.some(depId => {
            const dep = store.tasks.find(t => t.id === depId);
            return dep && dep.status !== 'done';
        });

        if (!hasBlockingDeps) {
            return task;
        }
    }

    // If no pending without deps, return first pending
    return pendingTasks[0] || null;
}

export function addTask(input: AddTaskInput, workspacePath: string = process.cwd()): Task {
    const store = loadTasks(workspacePath);
    const now = new Date().toISOString();

    const task: Task = {
        id: store.next_id,
        title: input.title,
        description: input.description,
        status: 'pending',
        priority: input.priority || 'medium',
        dependencies: input.dependencies || [],
        details: input.details,
        testStrategy: input.testStrategy,
        subtasks: [],
        created_at: now,
        updated_at: now
    };

    store.tasks.push(task);
    store.next_id++;
    saveTasks(store, workspacePath);

    return task;
}

export function setTaskStatus(id: number | string, status: TaskStatus, workspacePath: string = process.cwd()): Task | null {
    const store = loadTasks(workspacePath);

    // Handle subtask notation (e.g., "3.1" = subtask 1 of task 3)
    const idStr = String(id);
    if (idStr.includes('.')) {
        const [parentId, subtaskId] = idStr.split('.').map(Number);
        const parent = store.tasks.find(t => t.id === parentId);

        if (!parent) return null;

        const subtask = parent.subtasks.find(s => s.id === subtaskId);
        if (!subtask) return null;

        subtask.status = status;
        parent.updated_at = new Date().toISOString();
        saveTasks(store, workspacePath);

        return parent;
    }

    const taskId = typeof id === 'string' ? parseInt(id, 10) : id;
    const task = store.tasks.find(t => t.id === taskId);

    if (!task) return null;

    task.status = status;
    task.updated_at = new Date().toISOString();

    // If marking as done, also mark all subtasks as done
    if (status === 'done') {
        task.subtasks.forEach(s => s.status = 'done');
    }

    saveTasks(store, workspacePath);
    return task;
}

export async function expandTask(id: number, prompt?: string, workspacePath: string = process.cwd()): Promise<ExpandTaskResult> {
    const store = loadTasks(workspacePath);
    const task = store.tasks.find(t => t.id === id);

    if (!task) {
        return { success: false, error: `Task ${id} not found` };
    }

    try {
        const expandPrompt = `Task: ${task.title}\nDescription: ${task.description}${task.details ? `\nDetails: ${task.details}` : ''}${prompt ? `\nAdditional context: ${prompt}` : ''}`;

        const { text } = await createMessage(
            config.judgeModel,
            EXPAND_TASK_PROMPT,
            expandPrompt,
            0.3,
            2048
        );

        // Clean potential markdown code blocks
        let cleanJson = text.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(cleanJson);

        // Generate subtasks with IDs
        const newSubtasks: Subtask[] = (parsed.subtasks || []).map((s: any, i: number) => ({
            id: task.subtasks.length + i + 1,
            title: s.title || `Subtask ${i + 1}`,
            description: s.description || '',
            status: 'pending' as TaskStatus,
            dependencies: [],
            details: s.details
        }));

        task.subtasks.push(...newSubtasks);
        task.updated_at = new Date().toISOString();
        saveTasks(store, workspacePath);

        return { success: true, task, subtasks_added: newSubtasks.length };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to expand task: ${errorMsg}` };
    }
}

export function removeTask(id: number, workspacePath: string = process.cwd()): boolean {
    const store = loadTasks(workspacePath);
    const index = store.tasks.findIndex(t => t.id === id);

    if (index === -1) {
        return false;
    }

    store.tasks.splice(index, 1);
    saveTasks(store, workspacePath);
    return true;
}

export function clearSubtasks(id: number, workspacePath: string = process.cwd()): Task | null {
    const store = loadTasks(workspacePath);
    const task = store.tasks.find(t => t.id === id);

    if (!task) return null;

    task.subtasks = [];
    task.updated_at = new Date().toISOString();
    saveTasks(store, workspacePath);

    return task;
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

export function formatTaskList(tasks: Task[]): string {
    if (tasks.length === 0) {
        return 'No tasks found.';
    }

    const statusIcons: Record<TaskStatus, string> = {
        'pending': '⏳',
        'in-progress': '🔄',
        'done': '✅',
        'review': '👀',
        'deferred': '⏸️',
        'cancelled': '❌'
    };

    const priorityIcons: Record<TaskPriority, string> = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
    };

    let output = `# Tasks (${tasks.length})\n\n`;

    for (const task of tasks) {
        output += `${statusIcons[task.status]} **[${task.id}]** ${task.title} ${priorityIcons[task.priority]}\n`;
        output += `   ${task.description}\n`;

        if (task.dependencies.length > 0) {
            output += `   Dependencies: ${task.dependencies.join(', ')}\n`;
        }

        if (task.subtasks.length > 0) {
            output += `   Subtasks: ${task.subtasks.filter(s => s.status === 'done').length}/${task.subtasks.length} done\n`;
        }

        output += '\n';
    }

    return output;
}

export function formatTask(task: Task): string {
    const statusIcons: Record<TaskStatus, string> = {
        'pending': '⏳',
        'in-progress': '🔄',
        'done': '✅',
        'review': '👀',
        'deferred': '⏸️',
        'cancelled': '❌'
    };

    let output = `# Task ${task.id}: ${task.title}\n\n`;
    output += `**Status:** ${statusIcons[task.status]} ${task.status}\n`;
    output += `**Priority:** ${task.priority}\n`;
    output += `**Description:** ${task.description}\n`;

    if (task.details) {
        output += `\n**Details:**\n${task.details}\n`;
    }

    if (task.testStrategy) {
        output += `\n**Test Strategy:**\n${task.testStrategy}\n`;
    }

    if (task.dependencies.length > 0) {
        output += `\n**Dependencies:** ${task.dependencies.join(', ')}\n`;
    }

    if (task.subtasks.length > 0) {
        output += `\n## Subtasks (${task.subtasks.length})\n\n`;
        for (const sub of task.subtasks) {
            output += `${statusIcons[sub.status]} **[${task.id}.${sub.id}]** ${sub.title}\n`;
            output += `   ${sub.description}\n`;
            if (sub.details) {
                output += `   Details: ${sub.details}\n`;
            }
            output += '\n';
        }
    }

    return output;
}
