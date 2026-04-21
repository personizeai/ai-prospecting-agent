/**
 * Personize Memory CRUD — thin wrappers around the native SDK.
 *
 * Since @personize/sdk 0.9.x ships native update/bulkUpdate/filterByProperty/
 * propertyHistory/deleteRecord/cancelDeletion, this file just unwraps
 * `ApiResponse.data` so callers keep receiving the inner result object.
 *
 * Types are re-exported from the SDK so callers need no import changes.
 */

import { client } from '../config.js';
import type {
  ApiResponse,
  UpdatePropertyOptions,
  UpdateResult,
  BulkUpdateOptions,
  BulkUpdateResult,
  PropertyHistoryOptions,
  PropertyHistoryResult,
  FilterByPropertyOptions,
  FilterByPropertyResult,
  DeleteRecordOptions,
  CancelDeletionOptions,
  CancelDeletionResult,
  DeletionResult,
} from '@personize/sdk';

// ─── Re-exported types (back-compat aliases for existing callers) ──

export type UpdatePropertyRequest = UpdatePropertyOptions;
export type BulkUpdateRequest = BulkUpdateOptions;
export type PropertyHistoryRequest = PropertyHistoryOptions;
export type FilterByPropertyRequest = FilterByPropertyOptions;
export type DeleteRecordRequest = DeleteRecordOptions;
export type CancelDeletionRequest = CancelDeletionOptions;

export type {
  UpdateResult,
  BulkUpdateResult,
  PropertyHistoryResult,
  FilterByPropertyResult,
  CancelDeletionResult,
  DeletionResult,
};

// ─── Native-backed methods ─────────────────────────────────────────

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res?.success || res.data === undefined) {
    throw new Error(res?.error || res?.message || 'Personize API error');
  }
  return res.data;
}

export async function update(request: UpdatePropertyRequest): Promise<UpdateResult> {
  return unwrap(await client.memory.update(request));
}

export async function bulkUpdate(request: BulkUpdateRequest): Promise<BulkUpdateResult> {
  return unwrap(await client.memory.bulkUpdate(request));
}

export async function propertyHistory(request: PropertyHistoryRequest): Promise<PropertyHistoryResult> {
  return unwrap(await client.memory.propertyHistory(request));
}

export async function filterByProperty(request: FilterByPropertyRequest): Promise<FilterByPropertyResult> {
  return unwrap(await client.memory.filterByProperty(request));
}

export async function deleteRecord(request: DeleteRecordRequest): Promise<DeletionResult> {
  return unwrap(await client.memory.deleteRecord(request));
}

export async function cancelDeletion(request: CancelDeletionRequest): Promise<CancelDeletionResult> {
  return unwrap(await client.memory.cancelDeletion(request));
}

export const memoryCrud = {
  update,
  bulkUpdate,
  propertyHistory,
  filterByProperty,
  deleteRecord,
  cancelDeletion,
};
