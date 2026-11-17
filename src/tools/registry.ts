import type { Toolset } from '../config.js';
import { academicCalendarGetTool } from './academic-calendar-get.js';
import { campusEventsTool } from './campus-events.js';
import { clubGetTool } from './club-get.js';
import { clubSearchTool } from './club-search.js';
import { courseGetTool } from './course-get.js';
import { courseSearchTool } from './course-search.js';
import { gradesGetTool } from './grades-get.js';
import { professorGetTool } from './professor-get.js';
import { professorSearchTool } from './professor-search.js';
import { sectionGetTool } from './section-get.js';
import { sectionSearchTool } from './section-search.js';
import type { ToolDefinition } from './types.js';

/** Registration order is presentation order in MCP clients. */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  courseSearchTool,
  courseGetTool,
  sectionSearchTool,
  sectionGetTool,
  professorSearchTool,
  professorGetTool,
  gradesGetTool,
  academicCalendarGetTool,
  clubSearchTool,
  clubGetTool,
  campusEventsTool,
];

export function toolsFor(toolsets: readonly Toolset[]): ToolDefinition[] {
  const selected = new Set(toolsets);
  return ALL_TOOLS.filter((tool) => selected.has(tool.toolset));
}

export function toolCatalog(tools: readonly ToolDefinition[]): Record<Toolset, string[]> {
  const catalog: Record<Toolset, string[]> = { academics: [], clubs: [], events: [] };
  for (const tool of tools) {
    catalog[tool.toolset].push(tool.name);
  }
  return catalog;
}
