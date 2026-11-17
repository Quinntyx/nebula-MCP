import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { capArray, compact, ViewBounds } from '../format.js';
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

    const data = fitDetail((scale) => {
      const bounds = new ViewBounds();
      return compact({
        id: bounds.text(professor._id, 128),
        name: fullName(professor),
        first_name: bounds.text(professor.first_name, 80),
        last_name: bounds.text(professor.last_name, 80),
        titles: bounds.array(professor.titles, 5).map((title) => bounds.text(title, scaledCap(90, scale))),
        email: bounds.text(professor.email, 160) || undefined,
        phone: bounds.text(professor.phone_number, 80) || undefined,
        office: officeView(professor.office),
        office_hours: officeHours.items.map(meetingView),
        profile_uri: bounds.text(professor.profile_uri, 400) || undefined,
        section_count: professor.sections.length,
        section_ids: sectionIds.items.filter((id): id is string => typeof id === 'string').map((id) => bounds.text(id, 128)),
        truncated: bounds.truncated || officeHours.truncated || sectionIds.truncated || undefined,
      });
    });

    return success(
      data,
      {
        requests: result.requests,
        truncated: data['truncated'] === true,
        notes: [
          'Contact details are directory data from the upstream API; this server sends no messages.',
          'Section references are capped and not expanded; use section_search with the exact professor name.',
        ],
      },
      ctx.now,
    );
  },
};
