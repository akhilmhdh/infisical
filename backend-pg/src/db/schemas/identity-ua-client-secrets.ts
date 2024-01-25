// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const IdentityUaClientSecretsSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  clientSecretPrefix: z.string(),
  clientSecretHash: z.string(),
  clientSecretLastUsedAt: z.date().nullable().optional(),
  clientSecretNumUses: z.coerce.number().default(0),
  clientSecretNumUsesLimit: z.coerce.number().default(0),
  clientSecretTTL: z.coerce.number().default(0),
  isClientSecretRevoked: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
  identityUAId: z.string().uuid(),
});

export type TIdentityUaClientSecrets = z.infer<typeof IdentityUaClientSecretsSchema>;
export type TIdentityUaClientSecretsInsert = Omit<TIdentityUaClientSecrets, TImmutableDBKeys>;
export type TIdentityUaClientSecretsUpdate = Partial<Omit<TIdentityUaClientSecrets, TImmutableDBKeys>>;
