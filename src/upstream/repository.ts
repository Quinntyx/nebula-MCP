import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { NebulaClient } from '../client/http.js';
import { upstreamSchema } from '../errors.js';
import {
  academicCalendarSchema,
  clubSchema,
  courseSchema,
  eventSchema,
  gradeDataSchema,
  gradeDistributionSchema,
  professorSchema,
  sectionSchema,
  typedGradeDataSchema,
  type UpstreamAcademicCalendar,
  type UpstreamClub,
  type UpstreamCourse,
  type UpstreamEvent,
  type UpstreamGradeData,
  type UpstreamProfessor,
  type UpstreamSection,
  type UpstreamTypedGradeData,
} from './schemas.js';

export interface Fetched<T> {
  value: T;
  requests: number;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

export interface CourseSearchFilters {
  subject_prefix?: string | undefined;
  course_number?: string | undefined;
  title?: string | undefined;
  catalog_year?: string | undefined;
}

export interface ProfessorSearchFilters {
  first_name?: string | undefined;
  last_name?: string | undefined;
}

export interface GradeFilters {
  prefix?: string | undefined;
  number?: string | undefined;
  section_number?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
}

export interface CalendarEvent {
  building: string;
  room: string;
  event: UpstreamEvent;
}

export interface CalendarEventPage {
  date: string;
  events: CalendarEvent[];
  requests: number;
}

function parsed<S extends ZodTypeAny>(schema: S, data: unknown, what: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw upstreamSchema(`The Nebula API returned an unexpected ${what} payload.`);
  }
  return result.data as z.output<S>;
}

function queryOf(entries: object): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (typeof entry === 'string' && entry !== '') query[key] = entry;
  }
  return query;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Typed access to the public Nebula API. Every method performs exactly one
 * upstream request (except where noted) and validates the fields it maps.
 */
export class NebulaRepository {
  readonly #client: NebulaClient;

  constructor(client: NebulaClient) {
    this.#client = client;
  }

  get hasKey(): boolean {
    return this.#client.hasKey;
  }

  async searchCourses(
    filters: CourseSearchFilters,
    offset: number,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamCourse[]>> {
    const result = await this.#client.get(
      '/course',
      queryOf({ ...filters, offset: String(offset) }),
      options,
    );
    return { value: parsed(z.array(courseSchema), result.data, 'course list'), requests: result.requests };
  }

  async course(id: string, options: RequestOptions): Promise<Fetched<UpstreamCourse>> {
    const result = await this.#client.get(`/course/${segment(id)}`, undefined, options);
    return { value: parsed(courseSchema, result.data, 'course'), requests: result.requests };
  }

  async searchProfessors(
    filters: ProfessorSearchFilters,
    offset: number,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamProfessor[]>> {
    const result = await this.#client.get(
      '/professor',
      queryOf({ ...filters, offset: String(offset) }),
      options,
    );
    return {
      value: parsed(z.array(professorSchema), result.data, 'professor list'),
      requests: result.requests,
    };
  }

  async professor(id: string, options: RequestOptions): Promise<Fetched<UpstreamProfessor>> {
    const result = await this.#client.get(`/professor/${segment(id)}`, undefined, options);
    return { value: parsed(professorSchema, result.data, 'professor'), requests: result.requests };
  }

  async section(id: string, options: RequestOptions): Promise<Fetched<UpstreamSection>> {
    const result = await this.#client.get(`/section/${segment(id)}`, undefined, options);
    return { value: parsed(sectionSchema, result.data, 'section'), requests: result.requests };
  }

  async sectionProfessors(id: string, options: RequestOptions): Promise<Fetched<UpstreamProfessor[]>> {
    const result = await this.#client.get(`/section/${segment(id)}/professors`, undefined, options);
    return {
      value: parsed(z.array(professorSchema), result.data, 'section professor list'),
      requests: result.requests,
    };
  }

  /** Trends route: returns every indexed section for one exact course. */
  async trendsCourseSections(
    prefix: string,
    number: string,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamSection[]>> {
    const result = await this.#client.get(
      '/course/sections/trends',
      queryOf({ subject_prefix: prefix, course_number: number }),
      options,
    );
    return { value: parsed(z.array(sectionSchema), result.data, 'course trends'), requests: result.requests };
  }

  /** Trends route: returns every indexed section for one exact professor name. */
  async trendsProfessorSections(
    first: string,
    last: string,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamSection[]>> {
    const result = await this.#client.get(
      '/professor/sections/trends',
      queryOf({ first_name: first, last_name: last }),
      options,
    );
    return {
      value: parsed(z.array(sectionSchema), result.data, 'professor trends'),
      requests: result.requests,
    };
  }

  /** Trends route: returns sections matching one exact course and professor pair. */
  async trendsCombinedSections(
    prefix: string,
    number: string,
    first: string,
    last: string,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamSection[]>> {
    const result = await this.#client.get(
      '/combined/sections/trends',
      queryOf({ subject_prefix: prefix, course_number: number, first_name: first, last_name: last }),
      options,
    );
    return {
      value: parsed(z.array(sectionSchema), result.data, 'combined trends'),
      requests: result.requests,
    };
  }

  async gradesOverall(filters: GradeFilters, options: RequestOptions): Promise<Fetched<number[]>> {
    const result = await this.#client.get('/grades/overall', queryOf(filters), options);
    return { value: parsed(gradeDistributionSchema, result.data, 'grade distribution'), requests: result.requests };
  }

  async gradesSemester(filters: GradeFilters, options: RequestOptions): Promise<Fetched<UpstreamGradeData[]>> {
    const result = await this.#client.get('/grades/semester', queryOf(filters), options);
    return { value: parsed(z.array(gradeDataSchema), result.data, 'semester grades'), requests: result.requests };
  }

  async gradesSemesterSectionType(
    filters: GradeFilters,
    options: RequestOptions,
  ): Promise<Fetched<UpstreamTypedGradeData[]>> {
    const result = await this.#client.get('/grades/semester/sectionType', queryOf(filters), options);
    return {
      value: parsed(z.array(typedGradeDataSchema), result.data, 'section-type grades'),
      requests: result.requests,
    };
  }

  async gradesForCourse(id: string, options: RequestOptions): Promise<Fetched<number[]>> {
    const result = await this.#client.get(`/course/${segment(id)}/grades`, undefined, options);
    return { value: parsed(gradeDistributionSchema, result.data, 'course grades'), requests: result.requests };
  }

  async gradesForProfessor(id: string, options: RequestOptions): Promise<Fetched<number[]>> {
    const result = await this.#client.get(`/professor/${segment(id)}/grades`, undefined, options);
    return { value: parsed(gradeDistributionSchema, result.data, 'professor grades'), requests: result.requests };
  }

  async gradesForSection(id: string, options: RequestOptions): Promise<Fetched<number[]>> {
    const result = await this.#client.get(`/section/${segment(id)}/grades`, undefined, options);
    return { value: parsed(gradeDistributionSchema, result.data, 'section grades'), requests: result.requests };
  }

  async currentAcademicCalendar(options: RequestOptions): Promise<Fetched<UpstreamAcademicCalendar>> {
    const result = await this.#client.get('/academicCalendars/current', undefined, options);
    return {
      value: parsed(academicCalendarSchema, result.data, 'academic calendar'),
      requests: result.requests,
    };
  }

  async academicCalendar(termId: string, options: RequestOptions): Promise<Fetched<UpstreamAcademicCalendar>> {
    const result = await this.#client.get(`/academicCalendars/${segment(termId)}`, undefined, options);
    return {
      value: parsed(academicCalendarSchema, result.data, 'academic calendar'),
      requests: result.requests,
    };
  }

  async searchClubs(search: string, options: RequestOptions): Promise<Fetched<UpstreamClub[]>> {
    const result = await this.#client.get('/club/search', queryOf({ q: search }), options);
    // Upstream returns no row (and therefore null data) when nothing matches.
    const data = result.data ?? [];
    return { value: parsed(z.array(clubSchema), data, 'club list'), requests: result.requests };
  }

  async club(id: string, options: RequestOptions): Promise<Fetched<UpstreamClub>> {
    const result = await this.#client.get(`/club/${segment(id)}`, undefined, options);
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return { value: parsed(clubSchema, data, 'club'), requests: result.requests };
  }

  /**
   * One Comet Calendar page for a date, optionally narrowed to a building and a
   * room. The three upstream routes use different envelope shapes; they are
   * flattened here without emitting extra requests.
   */
  async calendarEvents(
    date: string,
    building: string | undefined,
    room: string | undefined,
    options: RequestOptions,
  ): Promise<CalendarEventPage> {
    const path =
      room !== undefined && building !== undefined
        ? `/calendar/${segment(date)}/${segment(building)}/${segment(room)}`
        : building !== undefined
          ? `/calendar/${segment(date)}/${segment(building)}`
          : `/calendar/${segment(date)}`;
    const result = await this.#client.get(path, undefined, options);
    return {
      date,
      events: flattenEvents(result.data),
      requests: result.requests,
    };
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Normalises the three calendar envelope shapes:
 *   { date, buildings: [{ building, rooms: [{ room, events: [] }] }] }
 *   { building, rooms: [...] }
 *   { room, events: [...] }
 */
export function flattenEvents(data: unknown): CalendarEvent[] {
  if (data === null || data === undefined) return [];
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw upstreamSchema('The Nebula API returned an unexpected calendar payload.');
  }
  const record = data as Record<string, unknown>;
  const events: CalendarEvent[] = [];

  const emit = (building: string, room: string, rawEvents: unknown): void => {
    for (const raw of Array.isArray(rawEvents) ? rawEvents : []) {
      const result = eventSchema.safeParse(raw);
      if (!result.success) {
        throw upstreamSchema('The Nebula API returned an unexpected calendar event payload.');
      }
      events.push({ building, room, event: result.data });
    }
  };

  if (Array.isArray(record.buildings)) {
    for (const buildingEntry of record.buildings) {
      if (typeof buildingEntry !== 'object' || buildingEntry === null) continue;
      const buildingRecord = buildingEntry as Record<string, unknown>;
      const building = typeof buildingRecord.building === 'string' ? buildingRecord.building : '';
      const rooms = Array.isArray(buildingRecord.rooms) ? buildingRecord.rooms : [];
      for (const roomEntry of rooms) {
        if (typeof roomEntry !== 'object' || roomEntry === null) continue;
        const roomRecord = roomEntry as Record<string, unknown>;
        emit(building, typeof roomRecord.room === 'string' ? roomRecord.room : '', roomRecord.events);
      }
    }
    return events;
  }

  if (Array.isArray(record.rooms)) {
    const building = typeof record.building === 'string' ? record.building : '';
    for (const roomEntry of record.rooms) {
      if (typeof roomEntry !== 'object' || roomEntry === null) continue;
      const roomRecord = roomEntry as Record<string, unknown>;
      emit(building, typeof roomRecord.room === 'string' ? roomRecord.room : '', roomRecord.events);
    }
    return events;
  }

  emit(
    typeof record.building === 'string' ? record.building : '',
    typeof record.room === 'string' ? record.room : '',
    record.events,
  );
  return events;
}

export { toStringArray };
