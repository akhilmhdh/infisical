import { z } from "zod";

import { ProjectsSchema } from "@app/db/schemas";
import { EventType } from "@app/ee/services/audit-log/audit-log-types";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

const projectWithEnv = ProjectsSchema.merge(
  z.object({
    _id: z.string(),
    environments: z.object({ name: z.string(), slug: z.string(), id: z.string() }).array(),
    type: z.string()
  })
);

export const registerProjectRouter = async (server: FastifyZodProvider) => {
  // Create a new V2 project.
  server.route({
    url: "/",
    method: "POST",
    schema: {
      body: z.object({
        projectName: z.string().trim(),
        inviteAllOrgMembers: z.boolean(),
        organizationId: z.string().trim()
      }),
      response: {
        200: z.object({
          workspace: projectWithEnv
        }),
        400: z.object({
          error: z.string()
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req) => {
      const project = await server.services.project.createProject({
        actorId: req.permission.id,
        actor: req.permission.type,
        orgId: req.body.organizationId,
        workspaceName: req.body.projectName
      });

      if (req.body.inviteAllOrgMembers) {
        const orgMembers = await server.services.org.findAllOrgMembers(
          req.permission.id,
          req.body.organizationId
        );

        const data = await server.services.projectMembership.addUsersToV2Project({
          actorId: req.permission.id,
          actor: req.permission.type,
          projectId: project.id,
          orgMembershipIds: orgMembers.map((u) => u.id)
        });

        await server.services.auditLog.createAuditLog({
          projectId: project.id,
          ...req.auditLogInfo,
          event: {
            type: EventType.ADD_BATCH_WORKSPACE_MEMBER,
            metadata: data.map(({ userId }) => ({
              userId: userId || "",
              email: ""
            }))
          }
        });

        console.log("Successfully invited all org members to project", {
          projectId: project.id
        });
      }

      console.log("Successfully created project", { projectId: project.id });

      return {
        workspace: {
          ...project,
          type: "v2"
        }
      };
    }
  });
};
