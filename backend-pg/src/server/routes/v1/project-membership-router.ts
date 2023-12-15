import { z } from "zod";

import { ProjectMembershipsSchema, UserEncryptionKeysSchema, UsersSchema } from "@app/db/schemas";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

export const registerProjectMembershipRouter = async (server: FastifyZodProvider) => {
  // TODO(akhilmhdh-pg): missing  adding multiple user workspace refer v2/membership

  server.route({
    url: "/:workspaceId/memberships",
    method: "GET",
    schema: {
      params: z.object({
        workspaceId: z.string().trim()
      }),
      response: {
        200: z.object({
          memberships: ProjectMembershipsSchema.merge(
            z.object({
              user: UsersSchema.pick({
                email: true,
                firstName: true,
                lastName: true,
                id: true
              }).merge(UserEncryptionKeysSchema.pick({ publicKey: true }))
            })
          )
            .omit({ createdAt: true, updatedAt: true })
            .array()
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const memberships = await server.services.projectMembership.getProjectMemberships({
        actorId: req.permission.id,
        actor: req.permission.type,
        projectId: req.params.workspaceId
      });
      return { memberships };
    }
  });

  server.route({
    url: "/:workspaceId/memberships/:membershipId",
    method: "PATCH",
    schema: {
      params: z.object({
        workspaceId: z.string().trim(),
        membershipId: z.string().trim()
      }),
      body: z.object({
        role: z.string().trim()
      }),
      response: {
        200: z.object({
          membership: ProjectMembershipsSchema
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const membership = await server.services.projectMembership.updateProjectMembership({
        actorId: req.permission.id,
        actor: req.permission.type,
        projectId: req.params.workspaceId,
        membershipId: req.params.membershipId,
        role: req.body.role
      });
      return { membership };
    }
  });

  server.route({
    url: "/:workspaceId/memberships/:membershipId",
    method: "DELETE",
    schema: {
      params: z.object({
        workspaceId: z.string().trim(),
        membershipId: z.string().trim()
      }),
      response: {
        200: z.object({
          membership: ProjectMembershipsSchema
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const membership = await server.services.projectMembership.deleteProjectMembership({
        actorId: req.permission.id,
        actor: req.permission.type,
        projectId: req.params.workspaceId,
        membershipId: req.params.membershipId
      });
      return { membership };
    }
  });
};
