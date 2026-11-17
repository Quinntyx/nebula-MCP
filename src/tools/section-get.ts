import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { canonicalSessionName } from '../domain/terms.js';
import { ToolError } from '../errors.js';
import { capArray, capText, compact } from '../format.js';
import type { UpstreamProfessor } from '../upstream/schemas.js';
import { objectIdShape, parseArgs } from './args.js';
import { fullName, meetingView } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'section_get';

const shape = { section_id: objectIdShape };
const schema = z.object(shape).strict();

export const sectionGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get a UT Dallas section',
  description: 'Get a UTD section by ID: term dates, meetings, instruction mode, core flags, syllabus, TAs and instructors. Use grades_get for grade counts.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const sectionResult = await ctx.repo.section(args.section_id, { signal: ctx.signal });
    const section = sectionResult.value;
    let requests = sectionResult.requests;

    let professors: UpstreamProfessor[] = [];
    let instructorsUnavailable = false;
    try {
      const professorResult = await ctx.repo.sectionProfessors(args.section_id, { signal: ctx.signal });
      professors = professorResult.value;
      requests += professorResult.requests;
    } catch (error) {
      if (error instanceof ToolError && error.code === 'NOT_FOUND') {
        instructorsUnavailable = true;
      } else {
        throw error;
      }
    }

    const meetings = capArray(section.meetings, 6);
    const instructors = capArray(professors, 8);
    const assistants = capArray(section.teaching_assistants, 6);
    const session = section.academic_session ?? undefined;
    const termId = canonicalSessionName(session?.name ?? '');

    const data = fitDetail((scale) =>
      compact({
        id: section._id,
        section_number: section.section_number || undefined,
        course_id: section.course_reference || undefined,
        internal_class_number: section.internal_class_number || undefined,
        instruction_mode: section.instruction_mode || undefined,
        term: session
          ? compact({
              id: termId,
              name: capText(session.name, scaledCap(60, scale)).text || undefined,
              start: session.start_date || undefined,
              end: session.end_date || undefined,
            })
          : undefined,
        core_flags: capArray(section.core_flags, 6).items,
        syllabus_uri: section.syllabus_uri || undefined,
        meetings: meetings.items.map(meetingView),
        professors: instructors.items.map((professor) =>
          compact({ id: professor._id, name: fullName(professor) }),
        ),
        teaching_assistants: assistants.items.map((assistant) =>
          compact({ name: fullName(assistant), role: assistant.role || undefined }),
        ),
      }),
    );

    const notes = [
      'Instructor names come from the section professor route, so a section lookup costs one extra upstream request.',
      'Meetings, instructors, and teaching assistants are capped to keep the result compact.',
    ];
    if (instructorsUnavailable) {
      notes.push('The upstream section lists instructor ids but returned no professor records for this section.');
    }

    return success(
      data,
      {
        requests,
        truncated: meetings.truncated || instructors.truncated || assistants.truncated,
        notes,
      },
      ctx.now,
    );
  },
};
