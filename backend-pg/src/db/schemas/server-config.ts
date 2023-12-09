// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const ServerConfigSchema = z.object({
  id: z.string().uuid(),
  initialized: z.boolean().default(false).nullable().optional(),
  allowSignUp: z.boolean().default(true).nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TServerConfig = z.infer<typeof ServerConfigSchema>;
export type TServerConfigInsert = Omit<TServerConfig, TImmutableDBKeys>;
export type TServerConfigUpdate = Partial<Omit<TServerConfig, TImmutableDBKeys>>;
