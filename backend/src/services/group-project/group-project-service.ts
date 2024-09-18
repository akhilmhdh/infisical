import { ForbiddenError } from "@casl/ability";
import ms from "ms";

import { ProjectMembershipRole, SecretKeyEncoding } from "@app/db/schemas";
import { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { ProjectPermissionActions, ProjectPermissionSub } from "@app/ee/services/permission/project-permission";
import { isAtLeastAsPrivileged } from "@app/lib/casl";
import { decryptAsymmetric, encryptAsymmetric } from "@app/lib/crypto";
import { infisicalSymmetricDecrypt } from "@app/lib/crypto/encryption";
import { BadRequestError, ForbiddenRequestError, NotFoundError } from "@app/lib/errors";
import { groupBy } from "@app/lib/fn";

import { TGroupDALFactory } from "../../ee/services/group/group-dal";
import { TUserGroupMembershipDALFactory } from "../../ee/services/group/user-group-membership-dal";
import { TProjectDALFactory } from "../project/project-dal";
import { TProjectBotDALFactory } from "../project-bot/project-bot-dal";
import { TProjectKeyDALFactory } from "../project-key/project-key-dal";
import { ProjectUserMembershipTemporaryMode } from "../project-membership/project-membership-types";
import { TProjectRoleDALFactory } from "../project-role/project-role-dal";
import { TGroupProjectDALFactory } from "./group-project-dal";
import { TGroupProjectMembershipRoleDALFactory } from "./group-project-membership-role-dal";
import {
  TCreateProjectGroupDTO,
  TDeleteProjectGroupDTO,
  TGetGroupInProjectDTO,
  TListProjectGroupDTO,
  TUpdateProjectGroupDTO
} from "./group-project-types";

type TGroupProjectServiceFactoryDep = {
  groupProjectDAL: Pick<TGroupProjectDALFactory, "findOne" | "transaction" | "create" | "delete" | "findByProjectId">;
  groupProjectMembershipRoleDAL: Pick<
    TGroupProjectMembershipRoleDALFactory,
    "create" | "transaction" | "insertMany" | "delete"
  >;
  userGroupMembershipDAL: Pick<TUserGroupMembershipDALFactory, "findGroupMembersNotInProject">;
  projectDAL: Pick<TProjectDALFactory, "findOne" | "findProjectGhostUser">;
  projectKeyDAL: Pick<TProjectKeyDALFactory, "findLatestProjectKey" | "delete" | "insertMany" | "transaction">;
  projectRoleDAL: Pick<TProjectRoleDALFactory, "find">;
  projectBotDAL: TProjectBotDALFactory;
  groupDAL: Pick<TGroupDALFactory, "findOne">;
  permissionService: Pick<TPermissionServiceFactory, "getProjectPermission" | "getProjectPermissionByRole">;
};

export type TGroupProjectServiceFactory = ReturnType<typeof groupProjectServiceFactory>;

export const groupProjectServiceFactory = ({
  groupDAL,
  groupProjectDAL,
  groupProjectMembershipRoleDAL,
  userGroupMembershipDAL,
  projectDAL,
  projectKeyDAL,
  projectBotDAL,
  projectRoleDAL,
  permissionService
}: TGroupProjectServiceFactoryDep) => {
  const addGroupToProject = async ({
    groupSlug,
    actor,
    actorId,
    actorOrgId,
    actorAuthMethod,
    projectSlug,
    roles
  }: TCreateProjectGroupDTO) => {
    const project = await projectDAL.findOne({
      slug: projectSlug
    });

    if (!project) throw new BadRequestError({ message: `Failed to find project with slug ${projectSlug}` });
    if (project.version < 2) throw new BadRequestError({ message: `Failed to add group to E2EE project` });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Create, ProjectPermissionSub.Groups);

    const group = await groupDAL.findOne({ orgId: actorOrgId, slug: groupSlug });
    if (!group) throw new BadRequestError({ message: `Failed to find group with slug ${groupSlug}` });

    const existingGroup = await groupProjectDAL.findOne({ groupId: group.id, projectId: project.id });
    if (existingGroup)
      throw new BadRequestError({
        message: `Group with slug ${groupSlug} already exists in project with id ${project.id}`
      });

    for await (const { role: requestedRoleChange } of roles) {
      const { permission: rolePermission } = await permissionService.getProjectPermissionByRole(
        requestedRoleChange,
        project.id
      );

      const hasRequiredPrivileges = isAtLeastAsPrivileged(permission, rolePermission);

      if (!hasRequiredPrivileges) {
        throw new ForbiddenRequestError({ message: "Failed to assign group to a more privileged role" });
      }
    }

    // validate custom roles input
    const customInputRoles = roles.filter(
      ({ role }) => !Object.values(ProjectMembershipRole).includes(role as ProjectMembershipRole)
    );
    const hasCustomRole = Boolean(customInputRoles.length);
    const customRoles = hasCustomRole
      ? await projectRoleDAL.find({
          projectId: project.id,
          $in: { slug: customInputRoles.map(({ role }) => role) }
        })
      : [];

    if (customRoles.length !== customInputRoles.length) {
      const customRoleSlugs = customRoles.map((customRole) => customRole.slug);
      const missingInputRoles = customInputRoles
        .filter((inputRole) => !customRoleSlugs.includes(inputRole.role))
        .map((role) => role.role);

      throw new NotFoundError({
        message: `Custom role/s not found: ${missingInputRoles.join(", ")}`
      });
    }
    const customRolesGroupBySlug = groupBy(customRoles, ({ slug }) => slug);

    const projectGroup = await groupProjectDAL.transaction(async (tx) => {
      const groupProjectMembership = await groupProjectDAL.create(
        {
          groupId: group.id,
          projectId: project.id
        },
        tx
      );

      const sanitizedProjectMembershipRoles = roles.map((inputRole) => {
        const isCustomRole = Boolean(customRolesGroupBySlug?.[inputRole.role]?.[0]);
        if (!inputRole.isTemporary) {
          return {
            projectMembershipId: groupProjectMembership.id,
            role: isCustomRole ? ProjectMembershipRole.Custom : inputRole.role,
            customRoleId: customRolesGroupBySlug[inputRole.role] ? customRolesGroupBySlug[inputRole.role][0].id : null
          };
        }

        // check cron or relative here later for now its just relative
        const relativeTimeInMs = ms(inputRole.temporaryRange);
        return {
          projectMembershipId: groupProjectMembership.id,
          role: isCustomRole ? ProjectMembershipRole.Custom : inputRole.role,
          customRoleId: customRolesGroupBySlug[inputRole.role] ? customRolesGroupBySlug[inputRole.role][0].id : null,
          isTemporary: true,
          temporaryMode: ProjectUserMembershipTemporaryMode.Relative,
          temporaryRange: inputRole.temporaryRange,
          temporaryAccessStartTime: new Date(inputRole.temporaryAccessStartTime),
          temporaryAccessEndTime: new Date(new Date(inputRole.temporaryAccessStartTime).getTime() + relativeTimeInMs)
        };
      });

      await groupProjectMembershipRoleDAL.insertMany(sanitizedProjectMembershipRoles, tx);

      // share project key with users in group that have not
      // individually been added to the project and that are not part of
      // other groups that are in the project
      const groupMembers = await userGroupMembershipDAL.findGroupMembersNotInProject(group.id, project.id, tx);

      if (groupMembers.length) {
        const ghostUser = await projectDAL.findProjectGhostUser(project.id, tx);

        if (!ghostUser) {
          throw new BadRequestError({
            message: "Failed to find sudo user"
          });
        }

        const ghostUserLatestKey = await projectKeyDAL.findLatestProjectKey(ghostUser.id, project.id, tx);

        if (!ghostUserLatestKey) {
          throw new BadRequestError({
            message: "Failed to find sudo user latest key"
          });
        }

        const bot = await projectBotDAL.findOne({ projectId: project.id }, tx);

        if (!bot) {
          throw new BadRequestError({
            message: "Failed to find bot"
          });
        }

        const botPrivateKey = infisicalSymmetricDecrypt({
          keyEncoding: bot.keyEncoding as SecretKeyEncoding,
          iv: bot.iv,
          tag: bot.tag,
          ciphertext: bot.encryptedPrivateKey
        });

        const plaintextProjectKey = decryptAsymmetric({
          ciphertext: ghostUserLatestKey.encryptedKey,
          nonce: ghostUserLatestKey.nonce,
          publicKey: ghostUserLatestKey.sender.publicKey,
          privateKey: botPrivateKey
        });

        const projectKeyData = groupMembers.map(({ user: { publicKey, id } }) => {
          const { ciphertext: encryptedKey, nonce } = encryptAsymmetric(plaintextProjectKey, publicKey, botPrivateKey);

          return {
            encryptedKey,
            nonce,
            senderId: ghostUser.id,
            receiverId: id,
            projectId: project.id
          };
        });

        await projectKeyDAL.insertMany(projectKeyData, tx);
      }

      return groupProjectMembership;
    });

    return projectGroup;
  };

  const updateGroupInProject = async ({
    projectSlug,
    groupSlug,
    roles,
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId
  }: TUpdateProjectGroupDTO) => {
    const project = await projectDAL.findOne({
      slug: projectSlug
    });

    if (!project) throw new BadRequestError({ message: `Failed to find project with slug ${projectSlug}` });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Edit, ProjectPermissionSub.Groups);

    const group = await groupDAL.findOne({ orgId: actorOrgId, slug: groupSlug });
    if (!group) throw new BadRequestError({ message: `Failed to find group with slug ${groupSlug}` });

    const projectGroup = await groupProjectDAL.findOne({ groupId: group.id, projectId: project.id });
    if (!projectGroup) throw new BadRequestError({ message: `Failed to find group with slug ${groupSlug}` });

    // validate custom roles input
    const customInputRoles = roles.filter(
      ({ role }) => !Object.values(ProjectMembershipRole).includes(role as ProjectMembershipRole)
    );
    const hasCustomRole = Boolean(customInputRoles.length);
    const customRoles = hasCustomRole
      ? await projectRoleDAL.find({
          projectId: project.id,
          $in: { slug: customInputRoles.map(({ role }) => role) }
        })
      : [];
    if (customRoles.length !== customInputRoles.length) {
      const customRoleSlugs = customRoles.map((customRole) => customRole.slug);
      const missingInputRoles = customInputRoles
        .filter((inputRole) => !customRoleSlugs.includes(inputRole.role))
        .map((role) => role.role);

      throw new NotFoundError({
        message: `Custom role/s not found: ${missingInputRoles.join(", ")}`
      });
    }

    const customRolesGroupBySlug = groupBy(customRoles, ({ slug }) => slug);

    const sanitizedProjectMembershipRoles = roles.map((inputRole) => {
      const isCustomRole = Boolean(customRolesGroupBySlug?.[inputRole.role]?.[0]);
      if (!inputRole.isTemporary) {
        return {
          projectMembershipId: projectGroup.id,
          role: isCustomRole ? ProjectMembershipRole.Custom : inputRole.role,
          customRoleId: customRolesGroupBySlug[inputRole.role] ? customRolesGroupBySlug[inputRole.role][0].id : null
        };
      }

      // check cron or relative here later for now its just relative
      const relativeTimeInMs = ms(inputRole.temporaryRange);
      return {
        projectMembershipId: projectGroup.id,
        role: isCustomRole ? ProjectMembershipRole.Custom : inputRole.role,
        customRoleId: customRolesGroupBySlug[inputRole.role] ? customRolesGroupBySlug[inputRole.role][0].id : null,
        isTemporary: true,
        temporaryMode: ProjectUserMembershipTemporaryMode.Relative,
        temporaryRange: inputRole.temporaryRange,
        temporaryAccessStartTime: new Date(inputRole.temporaryAccessStartTime),
        temporaryAccessEndTime: new Date(new Date(inputRole.temporaryAccessStartTime).getTime() + relativeTimeInMs)
      };
    });

    const updatedRoles = await groupProjectMembershipRoleDAL.transaction(async (tx) => {
      await groupProjectMembershipRoleDAL.delete({ projectMembershipId: projectGroup.id }, tx);
      return groupProjectMembershipRoleDAL.insertMany(sanitizedProjectMembershipRoles, tx);
    });

    return updatedRoles;
  };

  const removeGroupFromProject = async ({
    projectSlug,
    groupSlug,
    actorId,
    actor,
    actorOrgId,
    actorAuthMethod
  }: TDeleteProjectGroupDTO) => {
    const project = await projectDAL.findOne({
      slug: projectSlug
    });

    if (!project) throw new BadRequestError({ message: `Failed to find project with slug ${projectSlug}` });

    const group = await groupDAL.findOne({ orgId: actorOrgId, slug: groupSlug });
    if (!group) throw new BadRequestError({ message: `Failed to find group with slug ${groupSlug}` });

    const groupProjectMembership = await groupProjectDAL.findOne({ groupId: group.id, projectId: project.id });
    if (!groupProjectMembership) throw new BadRequestError({ message: `Failed to find group with slug ${groupSlug}` });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Delete, ProjectPermissionSub.Groups);

    const deletedProjectGroup = await groupProjectDAL.transaction(async (tx) => {
      const groupMembers = await userGroupMembershipDAL.findGroupMembersNotInProject(group.id, project.id, tx);

      if (groupMembers.length) {
        await projectKeyDAL.delete(
          {
            projectId: project.id,
            $in: {
              receiverId: groupMembers.map(({ user: { id } }) => id)
            }
          },
          tx
        );
      }

      const [projectGroup] = await groupProjectDAL.delete({ groupId: group.id, projectId: project.id }, tx);
      return projectGroup;
    });

    return deletedProjectGroup;
  };

  const listGroupsInProject = async ({
    projectSlug,
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId
  }: TListProjectGroupDTO) => {
    const project = await projectDAL.findOne({
      slug: projectSlug
    });

    if (!project) throw new BadRequestError({ message: `Failed to find project with slug ${projectSlug}` });

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Read, ProjectPermissionSub.Groups);

    const groupMemberships = await groupProjectDAL.findByProjectId(project.id);
    return groupMemberships;
  };

  const getGroupInProject = async ({
    projectSlug,
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId,
    groupSlug
  }: TGetGroupInProjectDTO) => {
    const project = await projectDAL.findOne({
      slug: projectSlug
    });

    if (!project) {
      throw new NotFoundError({ message: `Failed to find project with slug ${projectSlug}` });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      project.id,
      actorAuthMethod,
      actorOrgId
    );
    ForbiddenError.from(permission).throwUnlessCan(ProjectPermissionActions.Read, ProjectPermissionSub.Groups);

    const [groupMembership] = await groupProjectDAL.findByProjectId(project.id, {
      groupSlug
    });

    if (!groupMembership) {
      throw new NotFoundError({
        message: "Cannot find group membership"
      });
    }

    return groupMembership;
  };

  return {
    addGroupToProject,
    updateGroupInProject,
    removeGroupFromProject,
    listGroupsInProject,
    getGroupInProject
  };
};
