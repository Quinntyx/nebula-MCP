import { capArray, capText, compact } from '../format.js';
import { canonicalSessionName } from '../domain/terms.js';
import type { CalendarEvent } from '../upstream/repository.js';
import type {
  UpstreamAcademicCalendar,
  UpstreamBasicCourse,
  UpstreamBasicProfessor,
  UpstreamClub,
  UpstreamCourse,
  UpstreamMeeting,
  UpstreamProfessor,
  UpstreamSection,
} from '../upstream/schemas.js';

export function fullName(person: { first_name: string; last_name: string }): string {
  return `${person.first_name} ${person.last_name}`.trim();
}

export function courseCode(prefix: string, number: string): string {
  return `${prefix} ${number}`.trim();
}

export function meetingView(meeting: UpstreamMeeting): Record<string, unknown> {
  const location = meeting.location ?? undefined;
  return compact({
    days: capArray(meeting.meeting_days, 7).items,
    start: meeting.start_time || undefined,
    end: meeting.end_time || undefined,
    modality: meeting.modality || undefined,
    building: location?.building || undefined,
    room: location?.room || undefined,
  });
}

export function officeView(
  location: { building?: string | null | undefined; room?: string | null | undefined } | null | undefined,
): Record<string, unknown> | undefined {
  if (!location) return undefined;
  if (!location.building && !location.room) return undefined;
  return compact({
    building: location.building || undefined,
    room: location.room || undefined,
  });
}

export function courseSummaryRow(course: UpstreamCourse): Record<string, unknown> {
  return compact({
    id: course._id,
    code: courseCode(course.subject_prefix, course.course_number),
    title: capText(course.title, 90).text,
    credit_hours: course.credit_hours || undefined,
    catalog_year: course.catalog_year || undefined,
  });
}

export function professorRow(professor: UpstreamProfessor): Record<string, unknown> {
  return compact({
    id: professor._id,
    name: fullName(professor),
    titles: capArray(professor.titles, 3).items,
    email: professor.email || undefined,
    office: officeView(professor.office),
  });
}

export function termLabel(value: string): string {
  return canonicalSessionName(value) ?? capText(value, 24).text;
}

export function sectionRow(section: UpstreamSection): Record<string, unknown> {
  const course = section.course_details?.[0];
  const professors = capArray(section.professor_details ?? [], 4).items.map((professor) =>
    compact({ id: professor._id ?? undefined, name: fullName(professor) }),
  );
  return compact({
    id: section._id,
    course: course ? courseCode(course.subject_prefix, course.course_number) : undefined,
    course_id: (!course && section.course_reference) || undefined,
    title: course ? capText(course.title, 70).text : undefined,
    section: section.section_number || undefined,
    term: termLabel(section.academic_session?.name ?? ''),
    mode: section.instruction_mode || undefined,
    meetings: capArray(section.meetings, 3).items.map(meetingView),
    professors,
  });
}

export function basicCourseView(course: UpstreamBasicCourse): Record<string, unknown> {
  return compact({
    id: course._id ?? undefined,
    code: courseCode(course.subject_prefix, course.course_number),
    title: capText(course.title, 80).text,
    credit_hours: course.credit_hours || undefined,
  });
}

export function basicProfessorRef(professor: UpstreamBasicProfessor): Record<string, unknown> {
  return compact({ id: professor._id ?? undefined, name: fullName(professor) });
}

export function clubRow(club: UpstreamClub): Record<string, unknown> {
  return compact({
    id: club.id,
    slug: club.slug || undefined,
    name: capText(club.name, 90).text,
    tags: capArray(club.tags, 6).items,
    summary: capText(club.description, 160).text,
    updated_at: club.updated_at || undefined,
  });
}

export function eventRow(entry: CalendarEvent, descriptionCap: number): Record<string, unknown> {
  const { event } = entry;
  return compact({
    title: capText(event.summary, 110).text,
    start: event.start_time || undefined,
    end: event.end_time || undefined,
    building: entry.building || undefined,
    room: entry.room || undefined,
    types: capArray(event.event_type, 4).items,
    tags: capArray(event.event_tags, 6).items,
    url: event.event_website || undefined,
    description: capText(event.description, descriptionCap).text || undefined,
  });
}

function dateList(entries: readonly (readonly string[])[], maxEntries: number): string[][] {
  return capArray(entries, maxEntries).items.map((entry) => capArray(entry, 8).items.map((item) => capText(item, 120).text));
}

export function calendarView(calendar: UpstreamAcademicCalendar, scale: number): Record<string, unknown> {
  const sessions = capArray(calendar.sessions, 10).items.map((session) =>
    compact({
      name: capText(session.name, 80).text,
      begin: session.begin || undefined,
      last_registration: session.last_registration || undefined,
      late_registration: capArray(session.late_registration, 8).items.map((item) => capText(item, 120).text),
      census_day: session.census_day || undefined,
      drop_deadlines: session.drop_deadlines
        ? compact({
            without_w: session.drop_deadlines.without_w || undefined,
            undergrad_approval_required: session.drop_deadlines.undergrad_approval_required || undefined,
            graduate_withdrawl_ends: session.drop_deadlines.graduate_withdrawl_ends || undefined,
          })
        : undefined,
      end: session.end || undefined,
      reading_days: capArray(session.reading_days, 8).items.map((item) => capText(item, 120).text),
      exams: capArray(session.exams, 8).items.map((item) => capText(item, 120).text),
      final_grading_period: capArray(session.final_grading_period, 8).items.map((item) =>
        capText(item, 120).text,
      ),
    }),
  );

  return compact({
    id: calendar._id,
    timeline: calendar.timeline || undefined,
    enrollment_opens: calendar.enrollment_opens || undefined,
    schedule_planner_available: calendar.schedule_planner_available || undefined,
    online_add_swap_ends: calendar.online_add_swap_ends || undefined,
    last_readmission: calendar.last_readmission || undefined,
    last_from_waitlist: calendar.last_from_waitlist || undefined,
    midterms_due: calendar.midterms_due || undefined,
    university_closings: dateList(calendar.university_closings, Math.round(12 * Math.max(scale, 0.3))),
    no_classes: dateList(calendar.no_classes, Math.round(12 * Math.max(scale, 0.3))),
    sessions,
    upstream_url: calendar.url || undefined,
  });
}
