// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const SapApproversSchema = z.object({
  id: z.string().uuid(),
  approverId: z.string().uuid(),
  policyId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TSapApprovers = z.infer<typeof SapApproversSchema>;
export type TSapApproversInsert = Omit<TSapApprovers, TImmutableDBKeys>;
export type TSapApproversUpdate = Partial<Omit<TSapApprovers, TImmutableDBKeys>>;