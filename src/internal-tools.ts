import { OpenAITool } from './types.js';

export const internalTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'consult_council',
      description: 'Consults the MAKER-Council to make complex decisions, review code, or when multiple approaches are possible. Uses a voting system and a senior judge to reach a robust consensus.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The detailed question or the code to be analyzed.'
          },
          num_voters: {
            type: 'number',
            description: 'Number of voting micro-agents (1-10). Default: 3.'
          },
          k: {
            type: 'number',
            description: 'Voting margin (1-10). Default: 3.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'senior_code_review',
      description: `Performs a deep, skeptical code review assuming the code was written by a junior developer.
      
This tool applies the Senior Code Reviewer protocol with heightened scrutiny:
- Security vulnerabilities (SQLi, XSS, auth issues, data exposure)
- Performance issues (N+1 queries, memory leaks, O(n²) complexity)
- Code quality (SOLID, DRY, KISS, design patterns)
- Error handling (exception swallowing, null checks, edge cases)
- Testing & maintainability (coverage, documentation, config)

Returns a structured review with:
- Critical & Major issues with fixes
- Minor issues & suggestions
- Educational corner explaining concepts
- Quality score (1-10)`,
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The code to be reviewed. Include the full code snippet or file content.'
          },
          language: {
            type: 'string',
            description: 'Programming language of the code (e.g., typescript, python, java). Auto-detected if not provided.'
          },
          context: {
            type: 'string',
            description: 'Optional context about the code: what it does, where it runs, security requirements, etc.'
          },
          focus_areas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of specific areas to focus on: security, performance, architecture, error_handling, testing.'
          }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'solve_with_voting',
      description: 'Uses a fast voting system to answer objective questions or validate an approach. Ideal for well-defined problems with an expected answer.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The direct question to be resolved.'
          },
          k: {
            type: 'number',
            description: 'Voting margin (1-10). Default: 3.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'decompose_task',
      description: 'Breaks down a complex task into a list of smaller, more manageable subtasks. Useful for planning and understanding the scope of work.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The description of the complex task to be decomposed.'
          }
        },
        required: ['task']
      }
    }
  }
];