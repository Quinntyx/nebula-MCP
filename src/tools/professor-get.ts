import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { capArray, capText, compact } from '../format.js';
import { objectIdShape, parseArgs } from './args.js';
import { fullName, meetingView, officeView } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'professor_get';

const shape = { professor_id: objectIdShape };
const schema = z.object(shape).strict();

export const professorGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get a UT Dallas professor',
  description: 'Get a UTD professor by ID: directory contacts, office, office hours, profile and bounded section references. Does not expand courses.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const result = await ctx.repo.professor(args.professor_id, { signal: ctx.signal });
    const professor = result.value;

    const officeHours = capArray(professor.office_hours, 6);
    const sectionIds = capArray(professor.sections, 8);

    const data = fitDetail((scale) =>
      compact({
        id: professor._id,
        name: fullName(professor),
        first_name: professor.first_name,
        last_name: professor.last_name,
        titles: capArray(professor.titles, 5).items.map((title) => capText(title, scaledCap(90, scale)).text),
        email: professor.email || undefined,
        phone: professor.phone_number || undefined,
        office: officeView(professor.office),
        office_hours: officeHours.items.map(meetingView),
        profile_uri: professor.profile_uri || undefined,
        section_count: professor.sections.length,
        section_ids: sectionIds.items.filter((id): id is string => typeof id === 'string'),
      }),
    );

    return success(
      data,
      {
        requests: result.requests,
        truncated: officeHours.truncated || sectionIds.truncated,
        notes: [
          'Contact details are directory data from the upstream API; this server sends no messages.',
          'Section references are capped and not expanded; use section_search with the exact professor name.',
        ],
      },
      ctx.now,
    );
  },
};
