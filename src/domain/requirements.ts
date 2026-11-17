import { capText, isRecord } from '../format.js';

/**
 * Requirement trees arrive as loosely typed nested unions. They are rendered
 * into a compact, explicit form with bounded depth, node count, and text length
 * rather than being passed through.
 */
const MAX_NODES = 60;
const MAX_DEPTH = 6;
const MAX_TEXT = 160;

export interface RenderedRequirement {
  value: unknown;
  truncated: boolean;
}

interface RenderState {
  remaining: number;
  truncated: boolean;
}

export function renderRequirement(node: unknown): RenderedRequirement {
  const state: RenderState = { remaining: MAX_NODES, truncated: false };
  const value = renderNode(node, 0, state);
  return { value: value ?? null, truncated: state.truncated };
}

function renderNode(node: unknown, depth: number, state: RenderState): unknown {
  if (state.remaining <= 0) {
    state.truncated = true;
    return undefined;
  }
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  state.remaining -= 1;

  const type = typeof node.type === 'string' ? node.type : 'unknown';
  switch (type) {
    case 'course':
      return {
        type,
        course: capText(stringField(node, 'class_reference'), MAX_TEXT).text,
        minimum_grade: capText(stringField(node, 'minimum_grade'), 24).text,
      };
    case 'collection':
      return {
        type,
        name: capText(stringField(node, 'name'), MAX_TEXT).text,
        required: numberField(node, 'required'),
        options: renderOptions(node.options, depth, state),
      };
    case 'hours':
      return {
        type,
        hours: numberField(node, 'required'),
        options: renderOptions(node.options, depth, state),
      };
    case 'choice': {
      const choices = isRecord(node.choices) ? node.choices : node;
      return {
        type,
        name: capText(stringField(choices, 'name'), MAX_TEXT).text,
        required: numberField(choices, 'required'),
        options: renderOptions(choices.options, depth, state),
      };
    }
    case 'limit':
      return { type, max_hours: numberField(node, 'max_hours') };
    case 'core':
      return {
        type,
        core_flag: capText(stringField(node, 'core_flag'), 64).text,
        hours: numberField(node, 'hours'),
      };
    case 'gpa':
      return {
        type,
        minimum: typeof node.minimum === 'number' ? node.minimum : undefined,
        subset: capText(stringField(node, 'subset'), MAX_TEXT).text,
      };
    case 'major':
      return { type, major: capText(stringField(node, 'major'), MAX_TEXT).text };
    case 'minor':
      return { type, minor: capText(stringField(node, 'minor'), MAX_TEXT).text };
    case 'consent':
      return { type, granter: capText(stringField(node, 'granter'), MAX_TEXT).text };
    case 'section':
      return { type, section_reference: capText(stringField(node, 'section_reference'), 64).text };
    case 'other':
      return {
        type,
        description: capText(stringField(node, 'description'), MAX_TEXT).text,
        condition: capText(stringField(node, 'condition'), MAX_TEXT).text,
      };
    case 'none':
      return { type };
    default:
      return {
        type: 'unsupported',
        upstream_type: capText(type, 48).text,
        note: 'unrecognised requirement type; see the upstream course catalog',
      };
  }
}

function renderOptions(options: unknown, depth: number, state: RenderState): unknown[] {
  if (!Array.isArray(options)) return [];
  const rendered: unknown[] = [];
  for (const option of options) {
    const child = renderNode(option, depth + 1, state);
    if (child !== undefined) rendered.push(child);
    if (state.remaining <= 0) break;
  }
  return rendered;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
