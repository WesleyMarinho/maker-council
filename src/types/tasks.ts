/**
 * Task Types for MAKER-Council
 * Task management compatible with task-master format
 */

export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'review' | 'deferred' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface Subtask {
    id: number;
    title: string;
    description: string;
    status: TaskStatus;
    dependencies: number[];
    details?: string;
}

export interface Task {
    id: number;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    dependencies: number[];
    details?: string;
    testStrategy?: string;
    subtasks: Subtask[];
    created_at: string;
    updated_at: string;
}

export interface TasksStore {
    tasks: Task[];
    next_id: number;
    current_spec_id?: string;
}

export interface AddTaskInput {
    title: string;
    description: string;
    priority?: TaskPriority;
    dependencies?: number[];
    details?: string;
    testStrategy?: string;
}

export interface ExpandTaskResult {
    success: boolean;
    task?: Task;
    subtasks_added?: number;
    error?: string;
}
