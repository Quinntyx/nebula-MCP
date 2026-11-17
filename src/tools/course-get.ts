import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { renderRequirement } from '../domain/requirements.js';
import { capText, compact } from '../format.js';
import { objectIdShape, parseArgs } from './args.js';
import { courseCode } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'course_get';

const shape = { course_id: objectIdShape };
const schema = z.object(shape).strict();

export const courseGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get a UT Dallas course',
  description: 'Get a UTD course by ID: catalog metadata, description, prerequisite/corequisite tree and section count. Use course_search to find IDs.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const result = await ctx.repo.course(args.course_id, { signal: ctx.signal });
    const course = result.value;

    const prerequisites = renderRequirement(course.prerequisites);
    const corequisites = renderRequirement(course.corequisites);
    const coOrPre = renderRequirement(course.co_or_pre_requisites);
    const truncated = prerequisites.truncated || corequisites.truncated || coOrPre.truncated;

    const data = fitDetail((scale) =>
      compact({
        id: course._id,
        code: courseCode(course.subject_prefix, course.course_number),
        subject_prefix: course.subject_prefix,
        course_number: course.course_number,
        title: capText(course.title, scaledCap(160, scale)).text,
        catalog_year: course.catalog_year || undefined,
        credit_hours: course.credit_hours || undefined,
        school: course.school || undefined,
        class_level: course.class_level || undefined,
        activity_type: course.activity_type || undefined,
        grading: course.grading || undefined,
        offering_frequency: course.offering_frequency || undefined,
        lecture_contact_hours: course.lecture_contact_hours || undefined,
        laboratory_contact_hours: course.laboratory_contact_hours || undefined,
        description: capText(course.description, scaledCap(1_200, scale)).text || undefined,
        enrollment_requirements: capText(course.enrollment_reqs, scaledCap(400, scale)).text || undefined,
        section_count: course.sections.length,
        prerequisites: prerequisites.value,
        corequisites: corequisites.value,
        co_or_pre_requisites: coOrPre.value,
      }),
    );

    return success(
      data,
      {
        requests: result.requests,
        truncated,
        notes: [
          'Prerequisite and co-requisite trees keep their AND/OR structure with bounded depth, node count, and text length.',
          'Sections are counted only; call section_search with the exact subject prefix and course number for section records.',
        ],
      },
      ctx.now,
    );
  },
};
