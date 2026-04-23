type FieldContainer = Record<string, unknown>;

function readFieldValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value && typeof value === 'object' && 'value' in value) {
    return readFieldValue((value as { value?: unknown }).value);
  }

  return undefined;
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = readFieldValue(value);
    if (parsed) return parsed;
  }

  return undefined;
}

export function extractCompanyDomain(record: unknown): string | undefined {
  const company = (record ?? {}) as FieldContainer;
  const mainProperties = (company.mainProperties ?? {}) as FieldContainer;
  const properties = (company.properties ?? {}) as FieldContainer;

  return pickFirstString(
    company.website_url,
    company.website,
    mainProperties['website-url'],
    mainProperties['website_url'],
    mainProperties.website,
    mainProperties.domain,
    properties.website_url,
    properties.website,
    properties.domain,
  );
}

export function extractCompanyName(record: unknown, fallback?: string): string {
  const company = (record ?? {}) as FieldContainer;
  const mainProperties = (company.mainProperties ?? {}) as FieldContainer;
  const properties = (company.properties ?? {}) as FieldContainer;

  return pickFirstString(
    company.company_name,
    company.name,
    mainProperties['company-name'],
    mainProperties['company_name'],
    mainProperties.name,
    properties.company_name,
    properties.name,
    fallback,
  ) || 'unknown';
}
