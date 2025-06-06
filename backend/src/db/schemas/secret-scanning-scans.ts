// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const SecretScanningScansSchema = z.object({
  id: z.string().uuid(),
  status: z.string().default("queued"),
  statusMessage: z.string().nullable().optional(),
  type: z.string(),
  resourceId: z.string().uuid(),
  createdAt: z.date().nullable().optional()
});

export type TSecretScanningScans = z.infer<typeof SecretScanningScansSchema>;
export type TSecretScanningScansInsert = Omit<z.input<typeof SecretScanningScansSchema>, TImmutableDBKeys>;
export type TSecretScanningScansUpdate = Partial<Omit<z.input<typeof SecretScanningScansSchema>, TImmutableDBKeys>>;
