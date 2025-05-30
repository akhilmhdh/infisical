// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const InternalCertificateAuthoritiesSchema = z.object({
  id: z.string().uuid(),
  parentCaId: z.string().uuid().nullable().optional(),
  type: z.string(),
  friendlyName: z.string(),
  organization: z.string(),
  ou: z.string(),
  country: z.string(),
  province: z.string(),
  locality: z.string(),
  commonName: z.string(),
  dn: z.string(),
  serialNumber: z.string().nullable().optional(),
  maxPathLength: z.number().nullable().optional(),
  keyAlgorithm: z.string(),
  notBefore: z.date().nullable().optional(),
  notAfter: z.date().nullable().optional(),
  activeCaCertId: z.string().uuid().nullable().optional(),
  caId: z.string().uuid()
});

export type TInternalCertificateAuthorities = z.infer<typeof InternalCertificateAuthoritiesSchema>;
export type TInternalCertificateAuthoritiesInsert = Omit<
  z.input<typeof InternalCertificateAuthoritiesSchema>,
  TImmutableDBKeys
>;
export type TInternalCertificateAuthoritiesUpdate = Partial<
  Omit<z.input<typeof InternalCertificateAuthoritiesSchema>, TImmutableDBKeys>
>;
