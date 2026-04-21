// Central helper: unwrap a Personize SDK ApiResponse or throw a typed error
import type { ApiResponse } from '@personize/sdk';

export class PersonizeError extends Error {
  constructor(message: string, public code?: string, public raw?: unknown) {
    super(message);
    this.name = 'PersonizeError';
  }
}

export function unwrapOrThrow<T>(res: ApiResponse<T>): T {
  if (!res?.success || res.data === undefined) {
    throw new PersonizeError(
      res?.error || res?.message || 'Personize API error',
      typeof res?.error === 'string' ? res.error : undefined,
      res,
    );
  }
  return res.data;
}
