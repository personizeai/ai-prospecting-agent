import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CapacityStoreMode = 'file' | 'memory';

interface CapacityState {
  gmailSendsByDay: Record<string, Record<string, number>>;
  callsByDay: Record<string, number>;
  linkedinSendsByDay: Record<string, number>;
  interviewsByDay: Record<string, number>;
}

export interface CapacityStoreStatus {
  mode: CapacityStoreMode;
  path: string;
  lastError?: string;
}

function createEmptyState(): CapacityState {
  return {
    gmailSendsByDay: {},
    callsByDay: {},
    linkedinSendsByDay: {},
    interviewsByDay: {},
  };
}

let inMemoryState = createEmptyState();
let storeMode: CapacityStoreMode = 'file';
let storeError: string | undefined;

function getStorePath(): string {
  const configuredPath = process.env.CAPACITY_STATE_FILE?.trim();
  return configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), '.runtime', 'capacity-state.json');
}

function cloneState(state: CapacityState): CapacityState {
  return {
    gmailSendsByDay: Object.fromEntries(
      Object.entries(state.gmailSendsByDay).map(([day, counts]) => [day, { ...counts }]),
    ),
    callsByDay: { ...state.callsByDay },
    linkedinSendsByDay: { ...state.linkedinSendsByDay },
    interviewsByDay: { ...state.interviewsByDay },
  };
}

function normalizeState(value: unknown): CapacityState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  const state = value as Partial<CapacityState>;
  const gmailSendsByDay = typeof state.gmailSendsByDay === 'object' && state.gmailSendsByDay
    ? Object.fromEntries(
        Object.entries(state.gmailSendsByDay).map(([day, counts]) => [
          day,
          typeof counts === 'object' && counts
            ? Object.fromEntries(
                Object.entries(counts).map(([email, count]) => [email, Number(count) || 0]),
              )
            : {},
        ]),
      )
    : {};

  const callsByDay = typeof state.callsByDay === 'object' && state.callsByDay
    ? Object.fromEntries(
        Object.entries(state.callsByDay).map(([day, count]) => [day, Number(count) || 0]),
      )
    : {};

  const linkedinSendsByDay = typeof state.linkedinSendsByDay === 'object' && state.linkedinSendsByDay
    ? Object.fromEntries(
        Object.entries(state.linkedinSendsByDay).map(([day, count]) => [day, Number(count) || 0]),
      )
    : {};

  const interviewsByDay = typeof state.interviewsByDay === 'object' && state.interviewsByDay
    ? Object.fromEntries(
        Object.entries(state.interviewsByDay).map(([day, count]) => [day, Number(count) || 0]),
      )
    : {};

  return { gmailSendsByDay, callsByDay, linkedinSendsByDay, interviewsByDay };
}

function useMemoryFallback(error: unknown): void {
  storeMode = 'memory';
  storeError = error instanceof Error ? error.message : String(error);
}

function pruneState(state: CapacityState, today: string): CapacityState {
  return {
    gmailSendsByDay: state.gmailSendsByDay[today] ? { [today]: { ...state.gmailSendsByDay[today] } } : {},
    callsByDay: state.callsByDay[today] != null ? { [today]: state.callsByDay[today] } : {},
    linkedinSendsByDay: state.linkedinSendsByDay[today] != null
      ? { [today]: state.linkedinSendsByDay[today] }
      : {},
    interviewsByDay: state.interviewsByDay[today] != null
      ? { [today]: state.interviewsByDay[today] }
      : {},
  };
}

function readState(): CapacityState {
  if (storeMode === 'memory') {
    return cloneState(inMemoryState);
  }

  try {
    const raw = readFileSync(getStorePath(), 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return createEmptyState();
    }

    useMemoryFallback(error);
    return cloneState(inMemoryState);
  }
}

function writeState(nextState: CapacityState): void {
  const normalized = pruneState(nextState, getTodayUTC());

  if (storeMode === 'memory') {
    inMemoryState = normalized;
    return;
  }

  try {
    const storePath = getStorePath();
    mkdirSync(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify(normalized, null, 2), 'utf8');
  } catch (error) {
    useMemoryFallback(error);
    inMemoryState = normalized;
  }
}

export function getTodayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

export function getCapacityStoreStatus(): CapacityStoreStatus {
  return {
    mode: storeMode,
    path: getStorePath(),
    ...(storeError ? { lastError: storeError } : {}),
  };
}

export function getGmailSendCount(senderEmail: string): number {
  const state = readState();
  const today = getTodayUTC();
  return state.gmailSendsByDay[today]?.[senderEmail] || 0;
}

export function incrementGmailSendCount(senderEmail: string): number {
  const state = readState();
  const today = getTodayUTC();
  const todayCounts = { ...(state.gmailSendsByDay[today] || {}) };
  todayCounts[senderEmail] = (todayCounts[senderEmail] || 0) + 1;
  state.gmailSendsByDay[today] = todayCounts;
  writeState(state);
  return todayCounts[senderEmail];
}

export function getCallCount(): number {
  const state = readState();
  return state.callsByDay[getTodayUTC()] || 0;
}

export function incrementCallCount(): number {
  const state = readState();
  const today = getTodayUTC();
  state.callsByDay[today] = (state.callsByDay[today] || 0) + 1;
  writeState(state);
  return state.callsByDay[today];
}

export function getLinkedInSendCount(): number {
  const state = readState();
  return state.linkedinSendsByDay[getTodayUTC()] || 0;
}

export function incrementLinkedInSendCount(): number {
  const state = readState();
  const today = getTodayUTC();
  state.linkedinSendsByDay[today] = (state.linkedinSendsByDay[today] || 0) + 1;
  writeState(state);
  return state.linkedinSendsByDay[today];
}

export function getInterviewCount(): number {
  const state = readState();
  return state.interviewsByDay[getTodayUTC()] || 0;
}

export function incrementInterviewCount(): number {
  const state = readState();
  const today = getTodayUTC();
  state.interviewsByDay[today] = (state.interviewsByDay[today] || 0) + 1;
  writeState(state);
  return state.interviewsByDay[today];
}

/**
 * Test helper: clears module-level fallback state so tests can reconfigure
 * the storage path without restarting the process.
 */
export function resetCapacityStoreForTests(): void {
  inMemoryState = createEmptyState();
  storeMode = 'file';
  storeError = undefined;
}
