// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { zodBuffer } from "@app/lib/zod";

import { TImmutableDBKeys } from "./models";

export const OrganizationsSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  customerId: z.string().nullable().optional(),
  slug: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  authEnforced: z.boolean().default(false).nullable().optional(),
  scimEnabled: z.boolean().default(false).nullable().optional(),
  kmsDefaultKeyId: z.string().uuid().nullable().optional(),
  kmsEncryptedDataKey: zodBuffer.nullable().optional(),
  defaultMembershipRole: z.string().default("member"),
  enforceMfa: z.boolean().default(false),
  selectedMfaMethod: z.string().nullable().optional(),
  allowSecretSharingOutsideOrganization: z.boolean().default(true).nullable().optional()
});

export type TOrganizations = z.infer<typeof OrganizationsSchema>;
export type TOrganizationsInsert = Omit<z.input<typeof OrganizationsSchema>, TImmutableDBKeys>;
export type TOrganizationsUpdate = Partial<Omit<z.input<typeof OrganizationsSchema>, TImmutableDBKeys>>;
