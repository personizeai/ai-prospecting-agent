/**
 * Personize Memory CRUD — Type-safe wrappers for the new Memory CRUD API.
 *
 * These methods wrap direct HTTP calls to the Personize API until the SDK
 * ships native support for update(), bulkUpdate(), filterByProperty(),
 * propertyHistory(), deleteRecord(), and cancelDeletion().
 *
 * Once @personize/sdk ships these methods, replace this file with:
 *   export const memoryCrud = client.memory;
 *
 * API spec: https://github.com/personize/ai-fargate/Docs/MEMORY_CRUD_SDK_API_SPEC.md
 */

import { client } from '../config.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface UpdatePropertyRequest {
  recordId: string;
  type?: string;
  propertyName: string;
  propertyValue?: any;
  collectionId?: string;
  confidence?: number;
  reason?: string;
  updatedBy?: string;
  idempotencyKey?: string;
  expectedVersion?: number;
  // Array operations (mutually exclusive with propertyValue)
  arrayPush?: { items: any[]; unique?: boolean };
  arrayRemove?: { items?: any[]; indices?: number[] };
  arrayPatch?: { match: Record<string, any>; set: Record<string, any> };
}

export interface UpdateResult {
  success: boolean;
  previousValue?: any;
  newValue: any;
  version?: number;
  stores: {
    snapshot: 'updated' | 'skipped';
    lancedb: 'updated' | 'skipped';
    freeform: 'updated' | 'skipped';
  };
}

export interface BulkUpdateRequest {
  recordId: string;
  type?: string;
  updates: Array<{
    propertyName: string;
    propertyValue: any;
    collectionId?: string;
    confidence?: number;
  }>;
  updatedBy?: string;
  idempotencyKey?: string;
  expectedVersion?: number;
}

export interface BulkUpdateResult {
  success: boolean;
  results: Array<{
    propertyName: string;
    previousValue?: any;
    newValue: any;
    status: 'updated' | 'failed';
    error?: string;
  }>;
  version?: number;
}

export interface PropertyHistoryRequest {
  recordId: string;
  propertyName?: string;
  from?: string;
  to?: string;
  limit?: number;
  nextToken?: string;
}

export interface PropertyHistoryEntry {
  entryId: string;
  propertyName: string;
  propertyValue: any;
  collectionId: string;
  collectionName?: string;
  updatedBy: string;
  createdAt: string;
  source?: string;
}

export interface PropertyHistoryResult {
  entries: PropertyHistoryEntry[];
  nextToken?: string;
}

export type FilterOperator = 'equals' | 'notEquals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'isEmpty';

export interface PropertyFilterCondition {
  propertyName: string;
  operator: FilterOperator;
  value?: any;
}

export interface FilterByPropertyRequest {
  type?: string;
  conditions: PropertyFilterCondition[];
  logic?: 'AND' | 'OR';
  limit?: number;
  nextToken?: string;
}

export interface FilterByPropertyResult {
  records: Array<{
    recordId: string;
    type: string;
    matchedProperties: Record<string, any>;
    lastUpdatedAt?: number;
  }>;
  totalMatched: number;
  nextToken?: string;
}

export interface DeleteRecordRequest {
  recordId: string;
  type: string;
  reason?: string;
  performedBy?: string;
}

export interface CancelDeletionRequest {
  recordId: string;
  type?: string;
  performedBy?: string;
}

export interface CancelDeletionResult {
  success: boolean;
  restoredCounts: {
    snapshot: 'restored' | 'already_gone';
    freeform: 'restored' | 'already_gone';
    lancedb: 'restored' | 'already_gone';
  };
  warning?: string;
}

// ─── API Client ────────────────────────────────────────────────────

/** Extract the secret key and base URL from the existing Personize client. */
function getApiConfig(): { secretKey: string; baseUrl: string } {
  // The SDK stores the secret key — we read it from env directly
  const secretKey = process.env.PERSONIZE_SECRET_KEY!;
  const baseUrl = process.env.PERSONIZE_API_URL || 'https://api.personize.ai/api/v1';
  return { secretKey, baseUrl };
}

async function apiCall<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  const { secretKey, baseUrl } = getApiConfig();
  const url = `${baseUrl}/memory/${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secretKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json() as { success: boolean; data?: T; error?: { code: string; message: string } };

  if (!response.ok || !json.success) {
    const err = new Error(json.error?.message || `API error: ${response.status}`) as any;
    err.code = json.error?.code || `HTTP_${response.status}`;
    err.status = response.status;
    throw err;
  }

  return json.data as T;
}

// ─── Exported Methods ──────────────────────────────────────────────

/**
 * Update a single property on a record.
 * Supports direct value replacement, array operations, and optimistic concurrency.
 */
export async function update(request: UpdatePropertyRequest): Promise<UpdateResult> {
  return apiCall<UpdateResult>('update', request);
}

/**
 * Update multiple properties on a single record atomically.
 */
export async function bulkUpdate(request: BulkUpdateRequest): Promise<BulkUpdateResult> {
  return apiCall<BulkUpdateResult>('bulk-update', request);
}

/**
 * Query property change history for a record.
 */
export async function propertyHistory(request: PropertyHistoryRequest): Promise<PropertyHistoryResult> {
  return apiCall<PropertyHistoryResult>('property-history', request);
}

/**
 * Find records by structured property conditions (no LLM, deterministic).
 */
export async function filterByProperty(request: FilterByPropertyRequest): Promise<FilterByPropertyResult> {
  return apiCall<FilterByPropertyResult>('filter-by-property', request);
}

/**
 * Soft-delete all memories for a record (30-day recovery window).
 */
export async function deleteRecord(request: DeleteRecordRequest): Promise<{ success: boolean; deletedCount: number }> {
  return apiCall('delete-record', request);
}

/**
 * Cancel a pending soft-delete within the 30-day recovery window.
 */
export async function cancelDeletion(request: CancelDeletionRequest): Promise<CancelDeletionResult> {
  return apiCall<CancelDeletionResult>('cancel-deletion', request);
}

// ─── Convenience Export ────────────────────────────────────────────

export const memoryCrud = {
  update,
  bulkUpdate,
  propertyHistory,
  filterByProperty,
  deleteRecord,
  cancelDeletion,
};
