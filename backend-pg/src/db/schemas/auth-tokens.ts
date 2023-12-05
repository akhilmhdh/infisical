// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const AuthTokensSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  phoneNumber: z.string().nullable().optional(),
  tokenHash: z.string(),
  triesLeft: z.number().nullable().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  userId: z.string().uuid().nullable().optional(),
});

export type TAuthTokens = z.infer<typeof AuthTokensSchema>;
export type TAuthTokensInsert = Omit<TAuthTokens, TImmutableDBKeys>;
export type TAuthTokensUpdate = Partial<Omit<TAuthTokens, TImmutableDBKeys>>;
