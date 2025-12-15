import { OpenAITool } from './mcp-client/types.js';

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