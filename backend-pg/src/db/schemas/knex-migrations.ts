// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const KnexMigrationsSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  batch: z.number().nullable().optional(),
  migration_time: z.date().nullable().optional(),
});

export type TKnexMigrations = z.infer<typeof KnexMigrationsSchema>;
export type TKnexMigrationsInsert = Omit<TKnexMigrations, TImmutableDBKeys>;
export type TKnexMigrationsUpdate = Partial<Omit<TKnexMigrations, TImmutableDBKeys>>;
