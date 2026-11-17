import { z } from 'zod';
import { GRADE_BUCKET_COUNT } from '../domain/grades.js';

/**
 * Validation for the parts of the upstream payload this server maps. Unknown
 * members are tolerated (`.passthrough()`), but anything the output depends on
 * must be present with the documented type; otherwise the call fails closed with
 * `UPSTREAM_SCHEMA_ERROR` instead of emitting half-valid data.
 */
const text = z
  .string()
  .nullish()
  .transform((value) => value ?? '');

const textArray = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? []);

const idList = z
  .array(z.unknown())
  .nullish()
  .transform((value) => value ?? []);

export const locationSchema = z
  .object({
    building: z.string().nullish(),
    room: z.string().nullish(),
    map_uri: z.string().nullish(),
  })
  .passthrough();

export const meetingSchema = z
  .object({
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    meeting_days: textArray,
    start_time: z.string().nullish(),
    end_time: z.string().nullish(),
    modality: z.string().nullish(),
    location: locationSchema.nullish(),
  })
  .passthrough();

export type UpstreamMeeting = z.infer<typeof meetingSchema>;

export const assistantSchema = z
  .object({
    first_name: text,
    last_name: text,
    role: text,
    email: text,
  })
  .passthrough();

export const courseSchema = z
  .object({
    _id: z.string().min(1),
    subject_prefix: text,
    course_number: text,
    title: text,
    description: text,
    enrollment_reqs: text,
    school: text,
    credit_hours: text,
    class_level: text,
    activity_type: text,
    grading: text,
    internal_course_number: text,
    lecture_contact_hours: text,
    laboratory_contact_hours: text,
    offering_frequency: text,
    catalog_year: text,
    prerequisites: z.unknown().nullish(),
    corequisites: z.unknown().nullish(),
    co_or_pre_requisites: z.unknown().nullish(),
    sections: idList,
  })
  .passthrough();

export type UpstreamCourse = z.infer<typeof courseSchema>;

export const basicCourseSchema = z
  .object({
    _id: z.string().nullish(),
    subject_prefix: text,
    course_number: text,
    title: text,
    credit_hours: text,
    class_level: text,
    activity_type: text,
    catalog_year: text,
  })
  .passthrough();

export type UpstreamBasicCourse = z.infer<typeof basicCourseSchema>;

export const professorSchema = z
  .object({
    _id: z.string().min(1),
    first_name: text,
    last_name: text,
    titles: textArray,
    email: text,
    phone_number: text,
    office: locationSchema.nullish(),
    profile_uri: text,
    image_uri: text,
    office_hours: z
      .array(meetingSchema)
      .nullish()
      .transform((value) => value ?? []),
    sections: idList,
  })
  .passthrough();

export type UpstreamProfessor = z.infer<typeof professorSchema>;

export const basicProfessorSchema = z
  .object({
    _id: z.string().nullish(),
    first_name: text,
    last_name: text,
    email: text,
    phone_number: text,
    office: locationSchema.nullish(),
    office_hours: z
      .array(meetingSchema)
      .nullish()
      .transform((value) => value ?? []),
  })
  .passthrough();

export type UpstreamBasicProfessor = z.infer<typeof basicProfessorSchema>;

export const academicSessionSchema = z
  .object({
    name: text,
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
  })
  .passthrough();

export const gradeDistributionSchema = z.array(z.number().int().nonnegative()).length(GRADE_BUCKET_COUNT);

export const sectionSchema = z
  .object({
    _id: z.string().min(1),
    section_number: text,
    course_reference: z.string().nullish(),
    academic_session: academicSessionSchema.nullish(),
    professors: idList,
    teaching_assistants: z
      .array(assistantSchema)
      .nullish()
      .transform((value) => value ?? []),
    internal_class_number: text,
    instruction_mode: text,
    meetings: z
      .array(meetingSchema)
      .nullish()
      .transform((value) => value ?? []),
    core_flags: textArray,
    syllabus_uri: text,
    grade_distribution: gradeDistributionSchema.nullish(),
    course_details: z
      .array(basicCourseSchema)
      .nullish()
      .transform((value) => value ?? undefined),
    professor_details: z
      .array(basicProfessorSchema)
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .passthrough();

export type UpstreamSection = z.infer<typeof sectionSchema>;

export const gradeDataSchema = z
  .object({
    _id: z.string(),
    grade_distribution: gradeDistributionSchema,
  })
  .passthrough();

export type UpstreamGradeData = z.infer<typeof gradeDataSchema>;

export const typedGradeDataSchema = z
  .object({
    _id: z.string(),
    data: z.array(
      z
        .object({
          type: z.string().nullish(),
          grade_distribution: gradeDistributionSchema,
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type UpstreamTypedGradeData = z.infer<typeof typedGradeDataSchema>;

export const eventSchema = z
  .object({
    _id: z.string().nullish(),
    summary: z.string().min(1),
    location: text,
    start_time: text,
    end_time: text,
    description: text,
    event_type: textArray,
    target_audience: textArray,
    topic: textArray,
    event_tags: textArray,
    event_website: text,
    department: textArray,
  })
  .passthrough();

export type UpstreamEvent = z.infer<typeof eventSchema>;

export const clubSchema = z
  .object({
    slug: text,
    id: z.union([z.string(), z.number()]).transform((value) => String(value)),
    name: text,
    description: text,
    tags: textArray,
    profile_image: text,
    updated_at: z.string().nullish(),
    officers: z
      .array(z.record(z.string(), z.unknown()))
      .nullish()
      .transform((value) => value ?? []),
    contacts: z
      .array(
        z
          .object({ platform: text, url: text })
          .passthrough(),
      )
      .nullish()
      .transform((value) => value ?? []),
  })
  .passthrough();

export type UpstreamClub = z.infer<typeof clubSchema>;

export const academicCalendarSchema = z
  .object({
    _id: z.union([z.string(), z.number()]).transform((value) => String(value)),
    timeline: text,
    sessions: z
      .array(
        z
          .object({
            name: text,
            last_registration: text,
            begin: text,
            late_registration: textArray,
            census_day: text,
            drop_deadlines: z
              .object({
                without_w: text,
                undergrad_approval_required: text,
                graduate_withdrawl_ends: text,
              })
              .partial()
              .nullish(),
            end: text,
            reading_days: textArray,
            exams: textArray,
            final_grading_period: textArray,
          })
          .passthrough(),
      )
      .nullish()
      .transform((value) => value ?? []),
    enrollment_opens: text,
    schedule_planner_available: text,
    online_add_swap_ends: text,
    last_readmission: text,
    last_from_waitlist: text,
    midterms_due: text,
    university_closings: z
      .array(z.array(z.string()))
      .nullish()
      .transform((value) => value ?? []),
    no_classes: z
      .array(z.array(z.string()))
      .nullish()
      .transform((value) => value ?? []),
    url: text,
  })
  .passthrough();

export type UpstreamAcademicCalendar = z.infer<typeof academicCalendarSchema>;
