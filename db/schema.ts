import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const votes = pgTable('votes', {
  voterId: text('voter_id').primaryKey(),
  team: text('team').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check('votes_team_check', sql`${table.team} in ('boy', 'girl')`)]);
