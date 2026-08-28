import type { Diagnostic } from '../domain/validate.js';
import { SPEC_NODE_TYPES, SUPPORTED_DSL_VERSIONS, type PageTemplate, type Spec, type SpecNode, type SpecNodeType } from './types.js';

/**
 * EMCP-048 — Blueprints.md §2's DSL grammar, made real: parses and
 * structurally validates a spec document before any compiler (EMCP-049+)
 * ever sees it. Reuses `domain/validate.ts`'s `Diagnostic` shape (`path`,
 * `severity`, `code`, `message`, `allowed?`, `suggestion?`) — the same
 * diagnostic vocabulary Blueprints.md §3.4 documents for the compiler, so a
 * caller never has to handle two differently-shaped error lists depending
 * on which layer rejected a spec.
 *
 * **Deliberately hand-rolled, not Zod**, despite solution.md's stack table
 * naming Zod for validation. Every tool's `inputSchema`/`outputSchema` and
 * `domain/validate.ts` (EMCP-036) already established this codebase's real
 * practice — hand-written JSON Schema literals plus manual TypeScript type
 * narrowing, never Zod — before this task existed. Introducing Zod here
 * would mean two parallel validation idioms in one codebase for no benefit
 * this module actually needs; consistency with everything already built
 * wins over a stack-table line nothing has exercised yet.
 *
 * **Scope boundary, stated once here rather than repeated per check:**
 * this layer validates the spec is *syntactically* well-formed — the
 * shapes Blueprints.md §2 documents, independent of any particular site.
 * Anything requiring `siteProfile` (§3.1) — does this widget exist, is
 * this breakpoint real, does this token resolve — is the **compiler's**
 * job (EMCP-049+), not this one's. That split is Blueprints.md §3's own:
 * `compile(spec, siteProfile)` is where site-dependent semantics live;
 * grammar/schema is what's true or false about a spec on its own.
 */

const VALID_TYPES = new Set<string>(SPEC_NODE_TYPES);

export function parseSpec(input: unknown): { spec: Spec | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  if (!isRecord(input)) {
    diagnostics.push(malformed('', 'Spec must be an object.'));
    return { spec: null, diagnostics };
  }

  const versionDiagnostics = validateDslVersion(input['dslVersion']);
  diagnostics.push(...versionDiagnostics);

  const page = validatePage(input['page'], diagnostics);

  const rawElements = input['elements'];
  if (!Array.isArray(rawElements)) {
    diagnostics.push(malformed('elements', 'Spec "elements" is required and must be an array.'));
  }

  const elements: SpecNode[] = [];
  if (Array.isArray(rawElements)) {
    for (let i = 0; i < rawElements.length; i += 1) {
      const node = validateNode(rawElements[i], `elements[${i}]`, diagnostics);
      if (node) elements.push(node);
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  if (hasErrors || !page) {
    return { spec: null, diagnostics };
  }

  return {
    spec: { dslVersion: 1, page, elements },
    diagnostics,
  };
}

function validateDslVersion(value: unknown): Diagnostic[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [
      {
        path: 'dslVersion',
        severity: 'error',
        code: 'DSL_VERSION_UNSUPPORTED',
        message: '"dslVersion" is required and must be an integer.',
        allowed: SUPPORTED_DSL_VERSIONS.map(String),
      },
    ];
  }

  if (!SUPPORTED_DSL_VERSIONS.includes(value)) {
    return [
      {
        path: 'dslVersion',
        severity: 'error',
        code: 'DSL_VERSION_UNSUPPORTED',
        message: `dslVersion ${value} is not supported. A spec authored against a later grammar must fail loudly, not partially apply.`,
        allowed: SUPPORTED_DSL_VERSIONS.map(String),
      },
    ];
  }

  return [];
}

function validatePage(value: unknown, diagnostics: Diagnostic[]): Spec['page'] | null {
  if (!isRecord(value)) {
    diagnostics.push(malformed('page', 'Spec "page" is required and must be an object.'));
    return null;
  }

  if (typeof value['title'] !== 'string' || value['title'] === '') {
    diagnostics.push(malformed('page.title', 'Spec "page.title" is required and must be a non-empty string.'));
    return null;
  }

  const page: Spec['page'] = { title: value['title'] };

  if (value['template'] !== undefined) {
    const validTemplates = ['elementor_canvas', 'elementor_header_footer', 'elementor_theme', 'default'];
    if (typeof value['template'] !== 'string' || !validTemplates.includes(value['template'])) {
      diagnostics.push({
        path: 'page.template',
        severity: 'error',
        code: 'SPEC_MALFORMED',
        message: `"page.template" must be one of the recognized Elementor page templates.`,
        allowed: validTemplates,
      });
    } else {
      page.template = value['template'] as PageTemplate;
    }
  }

  if (value['status'] !== undefined) {
    // §2.1: "draft only; publishing is a separate tool" — any other value
    // is a grammar violation, not something this layer silently coerces.
    if (value['status'] !== 'draft') {
      diagnostics.push({
        path: 'page.status',
        severity: 'error',
        code: 'SPEC_MALFORMED',
        message: '"page.status" may only be "draft" — publishing goes through publish_draft, never the spec itself.',
        allowed: ['draft'],
      });
    } else {
      page.status = 'draft';
    }
  }

  return page;
}

function validateNode(value: unknown, path: string, diagnostics: Diagnostic[]): SpecNode | null {
  if (!isRecord(value)) {
    diagnostics.push(malformed(path, 'Each node must be an object.'));
    return null;
  }

  const type = value['type'];
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    diagnostics.push({
      path: `${path}.type`,
      severity: 'error',
      code: 'NODE_TYPE_UNKNOWN',
      message: `"${String(type)}" is not a recognized node type.`,
      allowed: [...SPEC_NODE_TYPES],
    });
    return null;
  }

  const nodeType = type as SpecNodeType;
  const commonErrors = validateCommonFields(value, path);
  diagnostics.push(...commonErrors);

  const hasRaw = value['raw'] !== undefined;
  const reasonGiven = typeof value['reason'] === 'string' && value['reason'] !== '';

  // §2.8 / §2.3: `reason` is mandatory whenever `raw` is present or the
  // node is the `html` escape rung — checked once here rather than per
  // caller, so no future node type can accidentally skip it.
  if ((hasRaw || nodeType === 'html') && !reasonGiven) {
    diagnostics.push({
      path: `${path}.reason`,
      severity: 'error',
      code: 'REASON_REQUIRED',
      message:
        nodeType === 'html'
          ? '"reason" is required on an "html" node — it is the non-native escape rung and every use is a reviewable event.'
          : '"reason" is required whenever "raw" is present — every raw use is counted into raw_ratio and logged.',
    });
  }

  const fieldErrors = validateTypeSpecificFields(nodeType, value, path);
  diagnostics.push(...fieldErrors);

  let children: SpecNode[] | undefined;
  if (value['children'] !== undefined) {
    if (!Array.isArray(value['children'])) {
      diagnostics.push(malformed(`${path}.children`, '"children" must be an array of nodes.'));
    } else {
      const validatedChildren: SpecNode[] = [];
      for (let i = 0; i < value['children'].length; i += 1) {
        const child = validateNode(value['children'][i], `${path}.children[${i}]`, diagnostics);
        if (child) validatedChildren.push(child);
      }
      children = validatedChildren;
    }
  }

  const hasErrorsSoFar = [...commonErrors, ...fieldErrors].some((d) => d.severity === 'error');
  if (hasErrorsSoFar) {
    return null;
  }

  const node = {
    type: nodeType,
    ...(typeof value['ref'] === 'string' && { ref: value['ref'] }),
    ...(typeof value['label'] === 'string' && { label: value['label'] }),
    ...(isRecord(value['layout']) && { layout: value['layout'] }),
    ...(isRecord(value['style']) && { style: value['style'] }),
    ...(isRecord(value['responsive']) && { responsive: value['responsive'] }),
    ...(children !== undefined && { children }),
    ...(hasRaw && isRecord(value['raw']) && { raw: value['raw'] }),
    ...(reasonGiven && { reason: value['reason'] }),
    ...extractTypeSpecificFields(nodeType, value),
  } as SpecNode;

  return node;
}

/**
 * Fields every node shares (§2.2), beyond `type` itself. `layout`/`style`/
 * `responsive` are only checked for being plain objects here — their
 * internal shape (§2.4/§2.5/§2.9) is deliberately not deep-validated by
 * this grammar layer; see the module docblock's scope boundary.
 */
function validateCommonFields(value: Record<string, unknown>, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (value['ref'] !== undefined && typeof value['ref'] !== 'string') {
    diagnostics.push(malformed(`${path}.ref`, '"ref" must be a string.'));
  }
  if (value['label'] !== undefined && typeof value['label'] !== 'string') {
    diagnostics.push(malformed(`${path}.label`, '"label" must be a string.'));
  }
  if (value['layout'] !== undefined && !isRecord(value['layout'])) {
    diagnostics.push(malformed(`${path}.layout`, '"layout" must be an object.'));
  }
  if (value['style'] !== undefined && !isRecord(value['style'])) {
    diagnostics.push(malformed(`${path}.style`, '"style" must be an object.'));
  }
  if (value['responsive'] !== undefined && !isRecord(value['responsive'])) {
    diagnostics.push(malformed(`${path}.responsive`, '"responsive" must be an object keyed by breakpoint name.'));
  }
  if (value['raw'] !== undefined && !isRecord(value['raw'])) {
    diagnostics.push(malformed(`${path}.raw`, '"raw" must be an object.'));
  }
  if (value['reason'] !== undefined && typeof value['reason'] !== 'string') {
    diagnostics.push(malformed(`${path}.reason`, '"reason" must be a string.'));
  }

  return diagnostics;
}

/** §2.3's per-type field table — required-field presence and basic type only. */
function validateTypeSpecificFields(type: SpecNodeType, value: Record<string, unknown>, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const requireString = (key: string, required: boolean): void => {
    const v = value[key];
    if (v === undefined) {
      if (required) diagnostics.push(fieldMissing(`${path}.${key}`, key, type));
      return;
    }
    if (typeof v !== 'string') diagnostics.push(malformed(`${path}.${key}`, `"${key}" must be a string.`));
  };

  switch (type) {
    case 'heading': {
      requireString('text', true);
      if (value['level'] !== undefined) {
        const level = value['level'];
        if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) {
          diagnostics.push(malformed(`${path}.level`, '"level" must be an integer from 1 to 6.'));
        }
      }
      break;
    }
    case 'text':
      requireString('html', true);
      break;
    case 'image': {
      const src = value['src'];
      if (src === undefined) {
        diagnostics.push(fieldMissing(`${path}.src`, 'src', type));
      } else if (typeof src !== 'string' && typeof src !== 'number') {
        diagnostics.push(malformed(`${path}.src`, '"src" must be a media id (number) or a URL (string).'));
      }
      requireString('alt', false);
      requireString('link', false);
      break;
    }
    case 'button':
      requireString('text', true);
      requireString('link', false);
      requireString('icon', false);
      break;
    case 'icon':
      requireString('name', true);
      requireString('link', false);
      break;
    case 'list': {
      const items = value['items'];
      if (items === undefined) {
        diagnostics.push(fieldMissing(`${path}.items`, 'items', type));
      } else if (!Array.isArray(items) || !items.every((i) => typeof i === 'string')) {
        diagnostics.push(malformed(`${path}.items`, '"items" must be an array of strings.'));
      }
      if (value['ordered'] !== undefined && typeof value['ordered'] !== 'boolean') {
        diagnostics.push(malformed(`${path}.ordered`, '"ordered" must be a boolean.'));
      }
      break;
    }
    case 'video':
      requireString('src', true);
      requireString('poster', false);
      if (value['autoplay'] !== undefined && typeof value['autoplay'] !== 'boolean') {
        diagnostics.push(malformed(`${path}.autoplay`, '"autoplay" must be a boolean.'));
      }
      break;
    case 'spacer': {
      const size = value['size'];
      if (size === undefined) {
        diagnostics.push(fieldMissing(`${path}.size`, 'size', type));
      } else if (typeof size !== 'number' && typeof size !== 'string') {
        diagnostics.push(malformed(`${path}.size`, '"size" must be a number or a string with a unit.'));
      }
      break;
    }
    case 'widget': {
      requireString('widgetType', true);
      if (value['settings'] !== undefined && !isRecord(value['settings'])) {
        diagnostics.push(malformed(`${path}.settings`, '"settings" must be an object.'));
      }
      break;
    }
    case 'shortcode':
      requireString('shortcode', true);
      break;
    case 'html':
      requireString('html', true);
      break;
    case 'container':
    case 'grid':
    case 'divider':
      // No type-specific required fields.
      break;
  }

  return diagnostics;
}

function extractTypeSpecificFields(type: SpecNodeType, value: Record<string, unknown>): Record<string, unknown> {
  const keys = TYPE_SPECIFIC_KEYS[type];
  const extracted: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) extracted[key] = value[key];
  }
  return extracted;
}

const TYPE_SPECIFIC_KEYS: Record<SpecNodeType, readonly string[]> = {
  container: [],
  grid: [],
  heading: ['text', 'level'],
  text: ['html'],
  image: ['src', 'alt', 'link'],
  button: ['text', 'link', 'icon'],
  icon: ['name', 'link'],
  list: ['items', 'ordered'],
  video: ['src', 'poster', 'autoplay'],
  divider: [],
  spacer: ['size'],
  widget: ['widgetType', 'settings'],
  shortcode: ['shortcode'],
  html: ['html'],
};

function fieldMissing(path: string, field: string, type: SpecNodeType): Diagnostic {
  return {
    path,
    severity: 'error',
    code: 'NODE_FIELD_MISSING',
    message: `"${field}" is required on a "${type}" node.`,
  };
}

function malformed(path: string, message: string): Diagnostic {
  return { path, severity: 'error', code: 'SPEC_MALFORMED', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
