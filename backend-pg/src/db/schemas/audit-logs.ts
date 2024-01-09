// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const AuditLogsSchema = z.object({
  id: z.string().uuid(),
  actor: z.string(),
  actorMetadata: z.unknown(),
  ipAddress: z.string().nullable().optional(),
  eventType: z.string(),
  eventMetadata: z.unknown().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  userAgentType: z.string().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  orgId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export type TAuditLogs = z.infer<typeof AuditLogsSchema>;
export type TAuditLogsInsert = Omit<TAuditLogs, TImmutableDBKeys>;
export type TAuditLogsUpdate = Partial<Omit<TAuditLogs, TImmutableDBKeys>>;
