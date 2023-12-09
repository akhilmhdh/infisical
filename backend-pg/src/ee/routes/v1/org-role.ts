import { z } from "zod";

import { OrgMembershipsSchema, OrgRolesSchema } from "@app/db/schemas";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

export const registerOrgRoleRouter = async (server: FastifyZodProvider) => {
  server.route({
    method: "POST",
    url: "/:organizationId/roles",
    schema: {
      params: z.object({
        organizationId: z.string().trim()
      }),
      body: z.object({
        slug: z.string().trim(),
        name: z.string().trim(),
        description: z.string().trim().optional(),
        workspaceId: z.string().trim().optional(),
        orgId: z.string().trim(),
        permissions: z.any().array()
      }),
      response: {
        200: z.object({
          role: OrgRolesSchema
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const role = await server.services.orgRole.createRole(
        req.auth.userId,
        req.params.organizationId,
        { ...req.body, permissions: JSON.stringify(req.body.permissions) }
      );
      return { role };
    }
  });

  server.route({
    method: "PATCH",
    url: "/:organizationId/roles/:roleId",
    schema: {
      params: z.object({
        organizationId: z.string().trim(),
        roleId: z.string().trim()
      }),
      body: z.object({
        slug: z.string().trim().optional(),
        name: z.string().trim().optional(),
        description: z.string().trim().optional(),
        workspaceId: z.string().trim().optional(),
        orgId: z.string().trim(),
        permissions: z.any().array()
      }),
      response: {
        200: z.object({
          role: OrgRolesSchema
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const role = await server.services.orgRole.updateRole(
        req.auth.userId,
        req.params.organizationId,
        req.params.roleId,
        {
          ...req.body,
          permissions: req.body.permissions ? JSON.stringify(req.body.permissions) : undefined
        }
      );
      return { role };
    }
  });

  server.route({
    method: "DELETE",
    url: "/:organizationId/roles/:roleId",
    schema: {
      params: z.object({
        organizationId: z.string().trim(),
        roleId: z.string().trim()
      }),
      response: {
        200: z.object({
          role: OrgRolesSchema
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const role = await server.services.orgRole.deleteRole(
        req.auth.userId,
        req.params.organizationId,
        req.params.roleId
      );
      return { role };
    }
  });

  server.route({
    method: "GET",
    url: "/:organizationId/roles",
    schema: {
      params: z.object({
        organizationId: z.string().trim()
      }),
      response: {
        200: z.object({
          roles: OrgRolesSchema.omit({ permissions: true })
            .merge(z.object({ permissions: z.unknown() }))
            .array()
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const roles = await server.services.orgRole.listRoles(
        req.auth.userId,
        req.params.organizationId
      );
      return { roles };
    }
  });

  server.route({
    method: "GET",
    url: "/:organizationId/permissions",
    schema: {
      params: z.object({
        organizationId: z.string().trim()
      }),
      response: {
        200: z.object({
          membership: OrgMembershipsSchema,
          permissions: z.any().array()
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const { permissions, membership } = await server.services.orgRole.getUserPermission(
        req.auth.userId,
        req.params.organizationId
      );
      return { permissions, membership };
    }
  });
};
