/**
 * Central memory facade — single import surface for all memory operations.
 *
 * Replace scattered `client.memory.*` call sites and the `personize-crud.ts`
 * shim with:  `import { memory } from './lib/memory.js'`
 */

import { client } from '../config.js';
import { unwrapOrThrow } from './personize-helpers.js';
import type {
  UpdatePropertyOptions,
  UpdateResult,
  BulkUpdateOptions,
  BulkUpdateResult,
  PropertyHistoryOptions,
  PropertyHistoryResult,
  FilterByPropertyOptions,
  FilterByPropertyResult,
  DeleteRecordOptions,
  DeletionResult,
  CancelDeletionOptions,
  CancelDeletionResult,
} from '@personize/sdk';

// ─── Write types ──────────────────────────────────────────────────────────────

export interface MemoryPropertyWrite {
  value: unknown;
  extractMemories?: boolean;
}

export interface MemorySaveInput {
  /** Contact email (preferred record identifier). */
  email?: string;
  /** Explicit record id (use when there is no email). */
  recordId?: string;
  /** Company/account identifier. */
  websiteUrl?: string;
  /** Entity type: 'Contact', 'Company', 'Campaign', etc. */
  type?: string;
  /** Freeform content to store. Required. */
  content: string;
  /** Structured properties to upsert on the record. */
  properties?: Record<string, MemoryPropertyWrite>;
  /** Collection name — routed server-side when properties are present. */
  collectionName?: string;
  /** Tags for categorization. */
  tags?: string[];
  /** AI extraction tier. */
  tier?: 'basic' | 'pro' | 'pro_fast' | 'ultra';
  /** Enable AI extraction loop. */
  enhanced?: boolean;
  /** Custom extraction prompt. */
  extractionPrompt?: string;
}

// ─── Read types ───────────────────────────────────────────────────────────────

export interface MemoryRetrieveInput {
  message: string;
  email?: string;
  emails?: string[];
  recordId?: string;
  recordIds?: string[];
  websiteUrl?: string;
  mode?: 'fast' | 'deep' | 'auto';
  limit?: number;
  generateAnswer?: boolean;
  enableReflection?: boolean;
  sessionId?: string;
  /** @deprecated Old `query` field — accepted and aliased to `message`. */
  query?: string;
}

// ─── Write methods ────────────────────────────────────────────────────────────

/** Save a single memory record; routes narrow vs. wide shape automatically. */
const save = async (input: MemorySaveInput): Promise<void> => {
  const hasStructured = Boolean(
    input.properties ||
      input.collectionName ||
      input.tags ||
      input.tier ||
      input.enhanced !== undefined ||
      input.extractionPrompt,
  );

  if (hasStructured) {
    // Wide shape: go through the (still-functional) deprecated memorize compatibility shim.
    // TODO(memory-save-wide): switch to client.memory.save once the SDK accepts the wide shape.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    unwrapOrThrow(await client.memory.memorize(input as any));
    return;
  }

  // Narrow shape: canonical save endpoint.
  unwrapOrThrow(
    await client.memory.save({
      content: input.content,
      email: input.email,
      recordId: input.recordId,
      websiteUrl: input.websiteUrl,
      type: input.type as 'Contact' | 'Company' | undefined,
    }),
  );
};

/** Save a batch of memory records. */
const saveBatch = async (records: MemorySaveInput[]): Promise<void> => {
  // TODO(memory-save-wide): switch to client.memory.saveBatch once the SDK shape converges.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  unwrapOrThrow(await client.memory.memorizeBatch({ records: records as any }));
};

// ─── Read methods ─────────────────────────────────────────────────────────────

/** Retrieve memories for an entity; supports fast/deep/auto modes. */
const retrieve = async (
  input: MemoryRetrieveInput,
): Promise<Awaited<ReturnType<typeof client.memory.retrieve>>['data']> => {
  const { query, message, mode, ...rest } = input;
  // Alias legacy `query` field to `message`.
  const resolvedMessage = message ?? query ?? '';
  const res = await client.memory.retrieve({
    ...rest,
    message: resolvedMessage,
    mode: mode ?? 'auto',
  });
  return unwrapOrThrow(res);
};

/** Retrieve a compiled context digest for an entity. */
const retrieveDigest = async (input: {
  email?: string;
  recordId?: string;
  websiteUrl?: string;
  maxTokens?: number;
  message?: string;
}): Promise<Awaited<ReturnType<typeof client.memory.retrieveDigest>>['data']> => {
  return unwrapOrThrow(await client.memory.retrieveDigest(input));
};

// ─── CRUD methods (from personize-crud.ts) ────────────────────────────────────

/** Upsert a structured property on a record. */
const update = async (input: UpdatePropertyOptions): Promise<UpdateResult> =>
  unwrapOrThrow(await client.memory.update(input));

/** Upsert structured properties across multiple records. */
const bulkUpdate = async (input: BulkUpdateOptions): Promise<BulkUpdateResult> =>
  unwrapOrThrow(await client.memory.bulkUpdate(input));

/** Filter records by a property condition. */
const filterByProperty = async (
  input: FilterByPropertyOptions,
): Promise<FilterByPropertyResult> => unwrapOrThrow(await client.memory.filterByProperty(input));

/** Get the change history for a property on a record. */
const propertyHistory = async (
  input: PropertyHistoryOptions,
): Promise<PropertyHistoryResult> => unwrapOrThrow(await client.memory.propertyHistory(input));

/** Soft-delete a record and all its memories. */
const deleteRecord = async (input: DeleteRecordOptions): Promise<DeletionResult> =>
  unwrapOrThrow(await client.memory.deleteRecord(input));

/** Cancel a pending soft-deletion before it is purged. */
const cancelDeletion = async (input: CancelDeletionOptions): Promise<CancelDeletionResult> =>
  unwrapOrThrow(await client.memory.cancelDeletion(input));

// ─── Public facade ────────────────────────────────────────────────────────────

export const memory = {
  save,
  saveBatch,
  retrieve,
  retrieveDigest,
  update,
  bulkUpdate,
  filterByProperty,
  propertyHistory,
  deleteRecord,
  cancelDeletion,
};
