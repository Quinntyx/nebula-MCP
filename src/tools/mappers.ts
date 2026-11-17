import { capText, compact, ViewBounds } from '../format.js';
import { canonicalSessionName } from '../domain/terms.js';
import type { CalendarEvent } from '../upstream/repository.js';
import type {
  UpstreamAcademicCalendar, UpstreamBasicCourse, UpstreamBasicProfessor,
  UpstreamClub, UpstreamCourse, UpstreamMeeting, UpstreamProfessor, UpstreamSection,
} from '../upstream/schemas.js';

export function fullName(person: { first_name: string; last_name: string }): string {
  return capText(`${person.first_name} ${person.last_name}`, 160).text;
}

export function courseCode(prefix: string, number: string): string {
  return capText(`${prefix} ${number}`, 40).text;
}

export function meetingView(meeting: UpstreamMeeting): Record<string, unknown> {
  const bounds = new ViewBounds();
  const location = meeting.location ?? undefined;
  return compact({
    days: bounds.array(meeting.meeting_days, 7).map((day) => bounds.text(day, 24)),
    start: bounds.text(meeting.start_time, 32) || undefined,
    end: bounds.text(meeting.end_time, 32) || undefined,
    modality: bounds.text(meeting.modality, 80) || undefined,
    building: bounds.text(location?.building, 40) || undefined,
    room: bounds.text(location?.room, 40) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function officeView(
  location: { building?: string | null | undefined; room?: string | null | undefined } | null | undefined,
): Record<string, unknown> | undefined {
  if (!location || (!location.building && !location.room)) return undefined;
  const bounds = new ViewBounds();
  return compact({
    building: bounds.text(location.building, 40) || undefined,
    room: bounds.text(location.room, 40) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function courseSummaryRow(course: UpstreamCourse): Record<string, unknown> {
  const bounds = new ViewBounds();
  return compact({
    id: bounds.text(course._id, 128),
    code: courseCode(course.subject_prefix, course.course_number),
    title: bounds.text(course.title, 90),
    credit_hours: bounds.text(course.credit_hours, 40) || undefined,
    catalog_year: bounds.text(course.catalog_year, 32) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function professorRow(professor: UpstreamProfessor): Record<string, unknown> {
  const bounds = new ViewBounds();
  return compact({
    id: bounds.text(professor._id, 128),
    name: bounds.text(`${professor.first_name} ${professor.last_name}`, 160),
    titles: bounds.array(professor.titles, 3).map((title) => bounds.text(title, 100)),
    email: bounds.text(professor.email, 160) || undefined,
    office: officeView(professor.office),
    truncated: bounds.truncated || undefined,
  });
}

export function termLabel(value: string): string {
  return canonicalSessionName(value) ?? capText(value, 24).text;
}

export function sectionRow(section: UpstreamSection): Record<string, unknown> {
  const bounds = new ViewBounds();
  const course = section.course_details?.[0];
  const professors = bounds.array(section.professor_details ?? [], 4).map((professor) =>
    compact({ id: bounds.text(professor._id, 128) || undefined, name: bounds.text(`${professor.first_name} ${professor.last_name}`, 160) }),
  );
  return compact({
    id: bounds.text(section._id, 128),
    course: course ? courseCode(course.subject_prefix, course.course_number) : undefined,
    course_id: !course ? bounds.text(section.course_reference, 128) || undefined : undefined,
    title: course ? bounds.text(course.title, 70) : undefined,
    section: bounds.text(section.section_number, 16) || undefined,
    term: termLabel(section.academic_session?.name ?? ''),
    mode: bounds.text(section.instruction_mode, 80) || undefined,
    meetings: bounds.array(section.meetings, 3).map(meetingView),
    professors,
    truncated: bounds.truncated || undefined,
  });
}

export function basicCourseView(course: UpstreamBasicCourse): Record<string, unknown> {
  const bounds = new ViewBounds();
  return compact({
    id: bounds.text(course._id, 128) || undefined,
    code: courseCode(course.subject_prefix, course.course_number),
    title: bounds.text(course.title, 80),
    credit_hours: bounds.text(course.credit_hours, 40) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function basicProfessorRef(professor: UpstreamBasicProfessor): Record<string, unknown> {
  return compact({ id: capText(professor._id, 128).text || undefined, name: fullName(professor) });
}

export function clubRow(club: UpstreamClub): Record<string, unknown> {
  const bounds = new ViewBounds();
  return compact({
    id: bounds.text(club.id, 128),
    slug: bounds.text(club.slug, 128) || undefined,
    name: bounds.text(club.name, 90),
    tags: bounds.array(club.tags, 6).map((tag) => bounds.text(tag, 80)),
    summary: bounds.text(club.description, 160),
    updated_at: bounds.text(club.updated_at, 64) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function eventRow(entry: CalendarEvent, descriptionCap: number): Record<string, unknown> {
  const bounds = new ViewBounds();
  const { event } = entry;
  return compact({
    title: bounds.text(event.summary, 110),
    start: bounds.text(event.start_time, 64) || undefined,
    end: bounds.text(event.end_time, 64) || undefined,
    building: bounds.text(entry.building, 40) || undefined,
    room: bounds.text(entry.room, 40) || undefined,
    types: bounds.array(event.event_type, 4).map((type) => bounds.text(type, 80)),
    tags: bounds.array(event.event_tags, 6).map((tag) => bounds.text(tag, 80)),
    url: bounds.text(event.event_website, 400) || undefined,
    description: bounds.text(event.description, descriptionCap) || undefined,
    truncated: bounds.truncated || undefined,
  });
}

export function calendarView(calendar: UpstreamAcademicCalendar, scale: number): Record<string, unknown> {
  const bounds = new ViewBounds();
  const dates = (entries: readonly string[]): string[] => bounds.array(entries, 8).map((item) => bounds.text(item, 120));
  const dateList = (entries: readonly (readonly string[])[]): string[][] =>
    bounds.array(entries, Math.max(2, Math.floor(12 * scale))).map(dates);
  const sessions = bounds.array(calendar.sessions, Math.max(1, Math.floor(10 * scale))).map((session) =>
    compact({
      name: bounds.text(session.name, 80),
      begin: bounds.text(session.begin, 120) || undefined,
      last_registration: bounds.text(session.last_registration, 120) || undefined,
      late_registration: dates(session.late_registration),
      census_day: bounds.text(session.census_day, 120) || undefined,
      drop_deadlines: session.drop_deadlines ? compact({
        without_w: bounds.text(session.drop_deadlines.without_w, 120) || undefined,
        undergrad_approval_required: bounds.text(session.drop_deadlines.undergrad_approval_required, 120) || undefined,
        graduate_withdrawl_ends: bounds.text(session.drop_deadlines.graduate_withdrawl_ends, 120) || undefined,
      }) : undefined,
      end: bounds.text(session.end, 120) || undefined,
      reading_days: dates(session.reading_days),
      exams: dates(session.exams),
      final_grading_period: dates(session.final_grading_period),
    }),
  );
  return compact({
    id: bounds.text(calendar._id, 32),
    timeline: bounds.text(calendar.timeline, 80) || undefined,
    enrollment_opens: bounds.text(calendar.enrollment_opens, 120) || undefined,
    schedule_planner_available: bounds.text(calendar.schedule_planner_available, 120) || undefined,
    online_add_swap_ends: bounds.text(calendar.online_add_swap_ends, 120) || undefined,
    last_readmission: bounds.text(calendar.last_readmission, 120) || undefined,
    last_from_waitlist: bounds.text(calendar.last_from_waitlist, 120) || undefined,
    midterms_due: bounds.text(calendar.midterms_due, 120) || undefined,
    university_closings: dateList(calendar.university_closings),
    no_classes: dateList(calendar.no_classes),
    sessions,
    session_count: calendar.sessions.length,
    upstream_url: bounds.text(calendar.url, 400) || undefined,
    truncated: bounds.truncated || undefined,
  });
}
