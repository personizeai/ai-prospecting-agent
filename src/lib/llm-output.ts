/**
 * Structured LLM Output Parser
 *
 * Enforces JSON output from LLM responses with a safe regex fallback.
 * Every pipeline uses this instead of hand-rolled regex parsing.
 */

// ─── Types ───────────────────────────────────────────────────────────

/** Schema field descriptor — used to build prompt instructions and validate output. */
export interface FieldDef {
  description: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required: boolean;
  default?: unknown;
  enumValues?: readonly string[];
}

export type SchemaMap = Record<string, FieldDef>;

/** Result of parsing LLM output. */
export interface ParseResult<T> {
  data: T;
  usedFallback: boolean;
  errors: string[];
}

// ─── JSON Extraction ─────────────────────────────────────────────────

/** Extract JSON from raw LLM output — handles bare JSON, code fences, and mixed text. */
function extractJson(raw: string): string | null {
  // Try code-fenced JSON first: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try bare JSON object
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return null;
}

// ─── Legacy Regex Fallback ───────────────────────────────────────────

/** Parse KEY: VALUE format (the old pattern). Used as fallback when JSON parsing fails. */
function parseKeyValue(raw: string, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Build a lookahead pattern that matches ANY known field key (not just the next one)
  const allKeysPattern = fields.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  for (const key of fields) {
    // Capture value between this key and the next known key (or end of string)
    const pattern = new RegExp(
      `(?:^|\\n)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([\\s\\S]+?)(?=\\n(?:${allKeysPattern}):|$)`,
      'i',
    );

    const match = raw.match(pattern);
    if (match) {
      result[key] = match[1].trim();
    }
  }

  return result;
}

// ─── Core Parser ─────────────────────────────────────────────────────

/**
 * Parse LLM output into a typed object.
 *
 * Strategy:
 * 1. Try JSON.parse (primary — what the prompt asks for)
 * 2. Fall back to KEY: VALUE regex (legacy compat — zero-risk rollout)
 * 3. Apply defaults for missing required fields
 */
export function parseLLMJson<T extends Record<string, unknown>>(
  raw: string,
  schema: SchemaMap,
  defaults: T,
): ParseResult<T> {
  const errors: string[] = [];
  let parsed: Record<string, unknown> | null = null;
  let usedFallback = false;

  // Step 1: Try JSON extraction
  const jsonStr = extractJson(raw);
  if (jsonStr) {
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      errors.push(`JSON parse failed: ${jsonStr.substring(0, 100)}...`);
    }
  }

  // Step 2: Fall back to regex KEY: VALUE parsing
  if (!parsed) {
    usedFallback = true;
    const fields = Object.keys(schema);
    const kvResult = parseKeyValue(raw, fields);
    if (Object.keys(kvResult).length > 0) {
      parsed = kvResult;
    } else {
      errors.push('Both JSON and KEY:VALUE parsing failed');
      return { data: { ...defaults }, usedFallback: true, errors };
    }
  }

  // Step 3: Validate and coerce fields against schema
  const data = { ...defaults } as Record<string, unknown>;

  for (const [key, def] of Object.entries(schema)) {
    const rawValue = parsed[key];

    if (rawValue === undefined || rawValue === null) {
      if (def.required && def.default === undefined) {
        errors.push(`Missing required field: ${key}`);
      }
      continue; // default already applied from spread
    }

    // Coerce to expected type
    switch (def.type) {
      case 'number': {
        const num = typeof rawValue === 'number' ? rawValue : parseInt(String(rawValue), 10);
        if (!isNaN(num)) {
          data[key] = num;
        } else {
          errors.push(`Invalid number for ${key}: ${rawValue}`);
        }
        break;
      }
      case 'boolean': {
        if (typeof rawValue === 'boolean') {
          data[key] = rawValue;
        } else {
          const str = String(rawValue).toLowerCase();
          data[key] = str === 'true' || str === 'yes';
        }
        break;
      }
      case 'string[]': {
        if (Array.isArray(rawValue)) {
          data[key] = rawValue.map(String);
        } else if (typeof rawValue === 'string') {
          // Handle comma-separated strings from regex fallback
          data[key] = rawValue.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
          data[key] = [];
        }
        break;
      }
      default: { // 'string'
        data[key] = String(rawValue).trim();
        break;
      }
    }

    // Enum validation
    if (def.enumValues && data[key] !== undefined) {
      const val = String(data[key]).toLowerCase();
      const match = def.enumValues.find((e) => e.toLowerCase() === val);
      if (match) {
        data[key] = match;
      } else {
        errors.push(`Invalid enum value for ${key}: "${data[key]}". Expected: ${def.enumValues.join(', ')}`);
        // Keep default
        data[key] = (defaults as Record<string, unknown>)[key];
      }
    }
  }

  return { data: data as T, usedFallback, errors };
}

// ─── Prompt Builder ──────────────────────────────────────────────────

/**
 * Build a JSON format instruction block to append to LLM prompts.
 *
 * Generates a clear instruction with the expected JSON schema,
 * including field descriptions and enum constraints.
 */
export function buildJsonInstruction(schema: SchemaMap): string {
  const example: Record<string, string> = {};

  for (const [key, def] of Object.entries(schema)) {
    if (def.enumValues) {
      example[key] = `[${def.enumValues.join('|')}]`;
    } else if (def.type === 'number') {
      example[key] = '(number)';
    } else if (def.type === 'boolean') {
      example[key] = '(true or false)';
    } else if (def.type === 'string[]') {
      example[key] = '["item1", "item2"]' as string;
    } else {
      example[key] = def.description;
    }
  }

  const jsonExample = JSON.stringify(example, null, 2)
    // Remove the quotes around type placeholders
    .replace(/"(\(number\))"/g, '0')
    .replace(/"(\(true or false\))"/g, 'true');

  return `

You MUST respond with valid JSON only — no other text, no markdown, no explanation.
Use this exact structure:

\`\`\`json
${jsonExample}
\`\`\``;
}
