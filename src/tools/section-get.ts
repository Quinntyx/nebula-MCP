import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { canonicalSessionName } from '../domain/terms.js';
import { ToolError } from '../errors.js';
import { capArray, compact, ViewBounds } from '../format.js';
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

    instructorsUnavailable ||= professors.length === 0 && section.professors.length > 0;
    const meetings = capArray(section.meetings, 6);
    const instructors = capArray(professors, 8);
    const assistants = capArray(section.teaching_assistants, 6);
    const session = section.academic_session ?? undefined;
    const termId = canonicalSessionName(session?.name ?? '');

    const data = fitDetail((scale) => {
      const bounds = new ViewBounds();
      return compact({
        id: bounds.text(section._id, 128),
        section_number: bounds.text(section.section_number, 16) || undefined,
        course_id: bounds.text(section.course_reference, 128) || undefined,
        internal_class_number: bounds.text(section.internal_class_number, 24) || undefined,
        instruction_mode: bounds.text(section.instruction_mode, 80) || undefined,
        term: session ? compact({
          id: termId,
          name: bounds.text(session.name, scaledCap(60, scale)) || undefined,
          start: bounds.text(session.start_date, 64) || undefined,
          end: bounds.text(session.end_date, 64) || undefined,
        }) : undefined,
        core_flags: bounds.array(section.core_flags, 6).map((flag) => bounds.text(flag, 80)),
        syllabus_uri: bounds.text(section.syllabus_uri, 400) || undefined,
        meetings: meetings.items.map(meetingView),
        professors: instructors.items.map((professor) => compact({ id: bounds.text(professor._id, 128), name: fullName(professor) })),
        teaching_assistants: assistants.items.map((assistant) => compact({ name: fullName(assistant), role: bounds.text(assistant.role, 80) || undefined })),
        truncated: bounds.truncated || meetings.truncated || instructors.truncated || assistants.truncated || undefined,
      });
    });

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
        truncated: data['truncated'] === true,
        notes,
      },
      ctx.now,
    );
  },
};
