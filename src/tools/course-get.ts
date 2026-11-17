import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { renderRequirement } from '../domain/requirements.js';
import { compact, ViewBounds } from '../format.js';
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

    const data = fitDetail((scale) => {
      const bounds = new ViewBounds();
      return compact({
        id: bounds.text(course._id, 128),
        code: courseCode(course.subject_prefix, course.course_number),
        subject_prefix: bounds.text(course.subject_prefix, 16),
        course_number: bounds.text(course.course_number, 16),
        title: bounds.text(course.title, scaledCap(160, scale)),
        catalog_year: bounds.text(course.catalog_year, 32) || undefined,
        credit_hours: bounds.text(course.credit_hours, 40) || undefined,
        school: bounds.text(course.school, 160) || undefined,
        class_level: bounds.text(course.class_level, 80) || undefined,
        activity_type: bounds.text(course.activity_type, 80) || undefined,
        grading: bounds.text(course.grading, 80) || undefined,
        offering_frequency: bounds.text(course.offering_frequency, 160) || undefined,
        lecture_contact_hours: bounds.text(course.lecture_contact_hours, 40) || undefined,
        laboratory_contact_hours: bounds.text(course.laboratory_contact_hours, 40) || undefined,
        description: bounds.text(course.description, scaledCap(1_200, scale)) || undefined,
        enrollment_requirements: bounds.text(course.enrollment_reqs, scaledCap(400, scale)) || undefined,
        section_count: course.sections.length,
        prerequisites: prerequisites.value,
        corequisites: corequisites.value,
        co_or_pre_requisites: coOrPre.value,
        truncated: bounds.truncated || truncated || undefined,
      });
    });

    return success(
      data,
      {
        requests: result.requests,
        truncated: data['truncated'] === true,
        notes: [
          'Prerequisite and co-requisite trees keep their AND/OR structure with bounded depth, node count, and text length.',
          'Sections are counted only; call section_search with the exact subject prefix and course number for section records.',
        ],
      },
      ctx.now,
    );
  },
};
