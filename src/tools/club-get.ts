import { z } from 'zod';
import { fitDetail, scaledCap } from '../domain/budget.js';
import { capArray, capText, compact } from '../format.js';
import { parseArgs } from './args.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'club_get';

/** Club ids are opaque upstream strings, not necessarily Mongo ids or slugs. */
const clubIdShape = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/, 'club_id must be a path-safe identifier')
  .refine((value) => !value.includes('..'), 'club_id must not contain dot segments');

const shape = { club_id: clubIdShape };
const schema = z.object(shape).strict();

export const clubGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get a UT Dallas club',
  description: [
    'Returns one student organization by Nebula API club id: description, tags, contacts, officers, and the upstream update timestamp.',
    'Contact links are returned as data and are never opened automatically.',
  ].join(' '),
  toolset: 'clubs',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const result = await ctx.repo.club(args.club_id, { signal: ctx.signal });
    const club = result.value;

    const contacts = capArray(club.contacts, 6);
    const officers = capArray(club.officers, 8);

    const data = fitDetail((scale) =>
      compact({
        id: club.id,
        slug: club.slug || undefined,
        name: capText(club.name, scaledCap(90, scale)).text,
        description: capText(club.description, scaledCap(1500, scale, 300)).text || undefined,
        tags: capArray(club.tags, 10).items,
        image: club.profile_image || undefined,
        contacts: contacts.items.map((contact) =>
          compact({ platform: contact.platform || undefined, url: capText(contact.url, 300).text || undefined }),
        ),
        officers: officers.items.map(officerView),
        updated_at: club.updated_at || undefined,
      }),
    );

    return success(
      data,
      {
        requests: result.requests,
        truncated: contacts.truncated || officers.truncated,
        notes: [
          'Organization details are self-reported in the upstream index; this server does not verify approval or active status.',
          'Officer and contact fields are capped for readability and are never followed automatically.',
        ],
      },
      ctx.now,
    );
  },
};

function officerView(officer: Record<string, unknown>): Record<string, unknown> {
  const text = (key: string): string | undefined => {
    const value = officer[key];
    return typeof value === 'string' && value.length > 0 ? capText(value, 80).text : undefined;
  };
  const name = [text('first_name'), text('last_name')].filter(Boolean).join(' ') || text('name');
  return compact({
    name: name || undefined,
    title: text('title') ?? text('position') ?? text('role'),
    email: text('email'),
  });
}
