/**
 * Synthetic upstream payloads. Field names mirror the verified Nebula API
 * response shapes; every value here is invented for offline tests.
 */

export const ID_A = '64b7f1f8f1f1f1f1f1f1f1f1';
export const ID_B = '64b7f1f8f1f1f1f1f1f1f1f2';
export const ID_C = '64b7f1f8f1f1f1f1f1f1f1f3';

export function course(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: ID_A,
    subject_prefix: 'CS',
    course_number: '1336',
    title: 'Introduction to Programming',
    description: 'Programming fundamentals for non-majors.',
    enrollment_reqs: '',
    school: 'Engineering and Computer Science',
    credit_hours: '3',
    class_level: 'Undergraduate',
    activity_type: 'Lecture',
    grading: 'Graded',
    internal_course_number: '0001',
    lecture_contact_hours: '3',
    laboratory_contact_hours: '0',
    offering_frequency: 'Every semester',
    catalog_year: '2024-2025',
    prerequisites: null,
    corequisites: null,
    co_or_pre_requisites: null,
    sections: [],
    ...overrides,
  };
}

export function professor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: ID_B,
    first_name: 'Ada',
    last_name: 'Lovelace',
    titles: ['Senior Lecturer'],
    email: 'ada.lovelace@example.edu',
    phone_number: '555-0100',
    office: { building: 'ECSS', room: '2.101', map_uri: '' },
    profile_uri: 'https://example.edu/profile',
    image_uri: '',
    office_hours: [
      {
        start_date: '2026-01-05',
        end_date: '2026-05-01',
        meeting_days: ['Monday', 'Wednesday'],
        start_time: '10:00 AM',
        end_time: '11:00 AM',
        modality: 'In Person',
        location: { building: 'ECSS', room: '2.101' },
      },
    ],
    sections: [ID_C],
    ...overrides,
  };
}

export function section(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: ID_C,
    section_number: '001',
    course_reference: ID_A,
    academic_session: { name: 'Fall 2026', start_date: '2026-08-17', end_date: '2026-12-03' },
    professors: [ID_B],
    teaching_assistants: [{ first_name: 'Grace', last_name: 'Hopper', role: 'TA', email: 'ta@example.edu' }],
    internal_class_number: '12345',
    instruction_mode: 'In Person',
    meetings: [
      {
        start_date: '2026-08-17',
        end_date: '2026-12-03',
        meeting_days: ['Monday', 'Wednesday'],
        start_time: '1:00 PM',
        end_time: '2:15 PM',
        modality: 'In Person',
        location: { building: 'ECSS', room: '3.202' },
      },
    ],
    core_flags: ['Core'],
    syllabus_uri: 'https://example.edu/syllabus',
    grade_distribution: distribution([3, 10, 2, 8, 6, 1, 4, 2, 0, 1, 0, 0, 1, 2]),
    course_details: [
      {
        _id: ID_A,
        subject_prefix: 'CS',
        course_number: '1336',
        title: 'Introduction to Programming',
        credit_hours: '3',
        class_level: 'Undergraduate',
        activity_type: 'Lecture',
        catalog_year: '2024-2025',
      },
    ],
    professor_details: [
      {
        _id: ID_B,
        first_name: 'Ada',
        last_name: 'Lovelace',
        titles: ['Senior Lecturer'],
        email: 'ada.lovelace@example.edu',
        phone_number: '555-0100',
        office: { building: 'ECSS', room: '2.101' },
        office_hours: [],
      },
    ],
    ...overrides,
  };
}

/** 14 non-negative integers, matching the verified bucket order. */
export function distribution(values?: readonly number[]): number[] {
  const base = values ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5];
  return [...base];
}

export function academicCalendar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: '26F',
    timeline: 'Fall 2026',
    sessions: [
      {
        name: 'Fall 2026 Full Term',
        last_registration: '2026-08-20',
        begin: '2026-08-17',
        late_registration: ['2026-08-21', '2026-08-28'],
        census_day: '2026-09-02',
        drop_deadlines: {
          without_w: '2026-09-02',
          undergrad_approval_required: '2026-10-30',
          graduate_withdrawl_ends: '2026-11-20',
        },
        end: '2026-12-03',
        reading_days: ['2026-12-04', '2026-12-07'],
        exams: ['2026-12-08', '2026-12-14'],
        final_grading_period: ['2026-12-15', '2026-12-18'],
      },
    ],
    enrollment_opens: '2026-04-06',
    schedule_planner_available: '2026-03-30',
    online_add_swap_ends: '2026-08-28',
    last_readmission: '2026-08-15',
    last_from_waitlist: '2026-08-19',
    midterms_due: '2026-10-16',
    university_closings: [['2026-11-26', '2026-11-27']],
    no_classes: [['2026-09-07']],
    url: 'https://example.edu/calendar',
    ...overrides,
  };
}

export function club(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'robotics-club',
    id: '4242',
    name: 'Robotics Club',
    description: 'Builds robots and competes in regional events.',
    tags: ['Engineering', 'Hobby'],
    profile_image: 'https://example.edu/logo.png',
    updated_at: '2026-02-01T00:00:00.000Z',
    officers: [{ name: 'Sam Rivers', role: 'President' }],
    contacts: [{ platform: 'discord', url: 'https://example.edu/discord' }],
    ...overrides,
  };
}

export function calendarEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'evt-1',
    summary: 'Robotics Club Meetup',
    location: 'ECSS 2.101',
    start_time: '2026-11-18T18:00:00-06:00',
    end_time: '2026-11-18T20:00:00-06:00',
    description: 'Open build session for members and guests.',
    event_type: ['Student Organization'],
    target_audience: ['Students'],
    topic: ['Technology'],
    event_tags: ['robotics'],
    event_website: 'https://example.edu/events/robotics',
    department: ['Student Affairs'],
    ...overrides,
  };
}

/** The widest envelope shape: date → buildings → rooms → events. */
export function calendarDateEnvelope(): Record<string, unknown> {
  return {
    date: '2026-11-18',
    buildings: [
      {
        building: 'ECSS',
        rooms: [{ room: '2.101', events: [calendarEvent(), calendarEvent({ _id: 'evt-2', summary: 'Guest Talk' })] }],
      },
    ],
  };
}
