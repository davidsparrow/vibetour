import type { AgentSnapshot } from '../../core/protocol';

/** How the cockpit names agents' roles and states (side mirrors, the radio's CB band, Work mode). */

export const ROLE_LABEL: Record<AgentSnapshot['role'], string> = {
  copilot: 'CO-PILOT',
  nav: 'NAV',
  eng: 'ENG',
  qa: 'QA',
  comms: 'COMMS',
  ops: 'OPS',
  crew: 'CREW',
};

export const STATUS_LABEL: Record<AgentSnapshot['status'], string> = {
  working: 'Working',
  tool: 'Using tools',
  waiting: 'Waiting for you',
  idle: 'Standing by',
  done: 'Finished',
  error: 'Needs help',
};
