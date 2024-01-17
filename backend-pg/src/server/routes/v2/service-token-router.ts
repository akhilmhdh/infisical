import { z } from "zod";

import { ServiceTokensSchema } from "@app/db/schemas";
import { EventType } from "@app/ee/services/audit-log/audit-log-types";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

export const sanitizedServiceTokenSchema = ServiceTokensSchema.omit({
  secretHash: true,
  encryptedKey: true,
  iv: true,
  tag: true
});

export const registerServiceTokenRouter = async (server: FastifyZodProvider) => {
  server.route({
    url: "/",
    method: "GET",
    onRequest: verifyAuth([AuthMode.JWT]),
    schema: {
      params: z.object({
        serviceTokenId: z.string().trim()
      }),
      response: {
        200: sanitizedServiceTokenSchema.merge(z.object({ workspace: z.string() }))
      }
    },
    handler: async (req) => {
      const serviceTokenData = await server.services.serviceToken.getServiceToken({
        actorId: req.permission.id,
        actor: req.permission.type
      });
      return { ...serviceTokenData, workspace: serviceTokenData.projectId };
    }
  });

  server.route({
    url: "/",
    method: "POST",
    onRequest: verifyAuth([AuthMode.JWT]),
    schema: {
      body: z.object({
        name: z.string().trim(),
        workspaceId: z.string().trim(),
        scopes: z
          .object({
            environment: z.string().trim(),
            secretPath: z.string().trim()
          })
          .array()
          .min(1),
        encryptedKey: z.string().trim(),
        iv: z.string().trim(),
        tag: z.string().trim(),
        expiresIn: z.number().nullable(),
        permissions: z.enum(["read", "write"]).array()
      }),
      response: {
        200: z.object({
          serviceToken: z.string(),
          serviceTokenData: sanitizedServiceTokenSchema
        })
      }
    },
    handler: async (req) => {
      const { serviceToken, token } = await server.services.serviceToken.createServiceToken({
        actorId: req.permission.id,
        actor: req.permission.type,
        ...req.body,
        projectId: req.body.workspaceId
      });

      await server.services.auditLog.createAuditLog({
        ...req.auditLogInfo,
        projectId: serviceToken.projectId,
        event: {
          type: EventType.CREATE_SERVICE_TOKEN,
          metadata: {
            name: serviceToken.name,
            scopes: req.body.scopes
          }
        }
      });
      return { serviceToken: token, serviceTokenData: serviceToken };
    }
  });

  server.route({
    url: "/:serviceTokenId",
    method: "DELETE",
    onRequest: verifyAuth([AuthMode.JWT]),
    schema: {
      params: z.object({
        serviceTokenId: z.string().trim()
      }),
      response: {
        200: z.object({
          serviceTokenData: sanitizedServiceTokenSchema
        })
      }
    },
    handler: async (req) => {
      const serviceTokenData = await server.services.serviceToken.deleteServiceToken({
        actorId: req.permission.id,
        actor: req.permission.type,
        id: req.params.serviceTokenId
      });

      await server.services.auditLog.createAuditLog({
        ...req.auditLogInfo,
        projectId: serviceTokenData.projectId,
        event: {
          type: EventType.DELETE_SERVICE_TOKEN,
          metadata: {
            name: serviceTokenData.name,
            scopes: serviceTokenData.scopes as Array<{ environment: string; secretPath: string }>
          }
        }
      });

      return { serviceTokenData };
    }
  });
};
