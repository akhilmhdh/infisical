import { z } from "zod";

import { IdentityUaClientSecretsSchema, IdentityUniversalAuthsSchema } from "@app/db/schemas";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

export const sanitizedClientSecretSchema = IdentityUaClientSecretsSchema.pick({
  id: true,
  createdAt: true,
  updatedAt: true,
  description: true,
  clientSecretPrefix: true,
  clientSecretNumUses: true,
  clientSecretNumUsesLimit: true,
  clientSecretTTL: true,
  identityUAId: true,
  isClientSecretRevoked: true
});

export const registerIdentityUaRouter = async (server: FastifyZodProvider) => {
  server.route({
    url: "/universal-auth/login",
    method: "POST",
    schema: {
      body: z.object({
        clientId: z.string().trim(),
        clientSecret: z.string().trim()
      }),
      response: {
        200: z.object({
          accessToken: z.string(),
          expiresIn: z.number(),
          accessTokenMaxTTL: z.number(),
          tokenType: z.literal("Bearer")
        })
      }
    },
    handler: async (req) => {
      const { identityUa, accessToken } = await server.services.identityUa.login(
        req.body.clientId,
        req.body.clientSecret
      );
      return {
        accessToken,
        tokenType: "Bearer" as const,
        expiresIn: identityUa.accessTokenTTL,
        accessTokenMaxTTL: identityUa.accessTokenMaxTTL
      };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId",
    method: "POST",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string().trim()
      }),
      body: z.object({
        clientSecretTrustedIps: z
          .object({
            ipAddress: z.string().trim()
          })
          .array()
          .min(1)
          .default([{ ipAddress: "0.0.0.0/0" }]),
        accessTokenTrustedIps: z
          .object({
            ipAddress: z.string().trim()
          })
          .array()
          .min(1)
          .default([{ ipAddress: "0.0.0.0/0" }]),
        accessTokenTTL: z
          .number()
          .int()
          .min(1)
          .refine((value) => value !== 0, {
            message: "accessTokenTTL must have a non zero number"
          })
          .default(2592000),
        accessTokenMaxTTL: z
          .number()
          .int()
          .refine((value) => value !== 0, {
            message: "accessTokenMaxTTL must have a non zero number"
          })
          .default(2592000), // 30 days
        accessTokenNumUsesLimit: z.number().int().min(0).default(0)
      }),
      response: {
        200: z.object({
          identityUniversalAuth: IdentityUniversalAuthsSchema
        })
      }
    },
    handler: async (req) => {
      const identityUniversalAuth = await server.services.identityUa.attachUa({
        actor: req.permission.type,
        actorId: req.permission.id,
        ...req.body,
        identityId: req.params.identityId
      });
      return { identityUniversalAuth };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId",
    method: "PATCH",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string()
      }),
      body: z.object({
        clientSecretTrustedIps: z
          .object({
            ipAddress: z.string().trim()
          })
          .array()
          .min(1)
          .optional(),
        accessTokenTrustedIps: z
          .object({
            ipAddress: z.string().trim()
          })
          .array()
          .min(1)
          .optional(),
        accessTokenTTL: z.number().int().min(0).optional(),
        accessTokenNumUsesLimit: z.number().int().min(0).optional(),
        accessTokenMaxTTL: z
          .number()
          .int()
          .refine((value) => value !== 0, {
            message: "accessTokenMaxTTL must have a non zero number"
          })
          .optional()
      }),
      response: {
        200: z.object({
          identityUniversalAuth: IdentityUniversalAuthsSchema
        })
      }
    },
    handler: async (req) => {
      const identityUniversalAuth = await server.services.identityUa.updateUa({
        actor: req.permission.type,
        actorId: req.permission.id,
        ...req.body,
        identityId: req.params.identityId
      });
      return { identityUniversalAuth };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId",
    method: "GET",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string()
      }),
      response: {
        200: z.object({
          identityUniversalAuth: IdentityUniversalAuthsSchema
        })
      }
    },
    handler: async (req) => {
      const identityUniversalAuth = await server.services.identityUa.getIdentityUa({
        actor: req.permission.type,
        actorId: req.permission.id,
        identityId: req.params.identityId
      });
      return { identityUniversalAuth };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId/client-secrets",
    method: "POST",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string()
      }),
      body: z.object({
        description: z.string().trim().default(""),
        numUsesLimit: z.number().min(0).default(0),
        ttl: z.number().min(0).default(0)
      }),
      response: {
        200: z.object({
          clientSecret: z.string(),
          clientSecretData: sanitizedClientSecretSchema
        })
      }
    },
    handler: async (req) => {
      const { clientSecret, clientSecretData } =
        await server.services.identityUa.createUaClientSecret({
          actor: req.permission.type,
          actorId: req.permission.id,
          identityId: req.params.identityId,
          ...req.body
        });
      return { clientSecret, clientSecretData };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId/client-secrets",
    method: "GET",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string()
      }),
      response: {
        200: z.object({
          clientSecretData: sanitizedClientSecretSchema.array()
        })
      }
    },
    handler: async (req) => {
      const clientSecretData = await server.services.identityUa.getUaClientSecrets({
        actor: req.permission.type,
        actorId: req.permission.id,
        identityId: req.params.identityId
      });
      return { clientSecretData };
    }
  });

  server.route({
    url: "/universal-auth/identities/:identityId/client-secrets/:clientSecretId/revoke",
    method: "POST",
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    schema: {
      params: z.object({
        identityId: z.string(),
        clientSecretId: z.string()
      }),
      response: {
        200: z.object({
          clientSecretData: sanitizedClientSecretSchema
        })
      }
    },
    handler: async (req) => {
      const clientSecretData = await server.services.identityUa.revokeUaClientSecret({
        actor: req.permission.type,
        actorId: req.permission.id,
        identityId: req.params.identityId,
        clientSecretId: req.params.clientSecretId
      });
      return { clientSecretData };
    }
  });
};
