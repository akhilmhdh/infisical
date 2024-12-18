// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { zodBuffer } from "@app/lib/zod";

import { TImmutableDBKeys } from "./models";

export const KmsRootConfigSchema = z.object({
  id: z.string().uuid(),
  encryptedRootKey: zodBuffer,
  encryptionStrategy: z.string().default("SOFTWARE").nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type TKmsRootConfig = z.infer<typeof KmsRootConfigSchema>;
export type TKmsRootConfigInsert = Omit<z.input<typeof KmsRootConfigSchema>, TImmutableDBKeys>;
export type TKmsRootConfigUpdate = Partial<Omit<z.input<typeof KmsRootConfigSchema>, TImmutableDBKeys>>;
