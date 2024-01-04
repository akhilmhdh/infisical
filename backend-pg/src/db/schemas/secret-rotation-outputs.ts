// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const SecretRotationOutputsSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  secretId: z.string().uuid(),
  rotationId: z.string().uuid(),
});

export type TSecretRotationOutputs = z.infer<typeof SecretRotationOutputsSchema>;
export type TSecretRotationOutputsInsert = Omit<TSecretRotationOutputs, TImmutableDBKeys>;
export type TSecretRotationOutputsUpdate = Partial<Omit<TSecretRotationOutputs, TImmutableDBKeys>>;
