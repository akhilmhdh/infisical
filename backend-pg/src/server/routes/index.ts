import { Knex } from "knex";
import { z } from "zod";

import { registerV1EERoutes } from "@app/ee/routes/v1";
import { permissionDalFactory } from "@app/ee/services/permission/permission-dal";
import { permissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { getConfig } from "@app/lib/config/env";
import { apiKeyDalFactory } from "@app/services/api-key/api-key-dal";
import { apiKeyServiceFactory } from "@app/services/api-key/api-key-service";
import { authDalFactory } from "@app/services/auth/auth-dal";
import { authLoginServiceFactory } from "@app/services/auth/auth-login-service";
import { authPaswordServiceFactory } from "@app/services/auth/auth-password-service";
import { authSignupServiceFactory } from "@app/services/auth/auth-signup-service";
import { tokenDalFactory } from "@app/services/auth-token/auth-token-dal";
import { tokenServiceFactory } from "@app/services/auth-token/auth-token-service";
import { integrationDalFactory } from "@app/services/integration/integration-dal";
import { integrationServiceFactory } from "@app/services/integration/integration-service";
import { integrationAuthDalFactory } from "@app/services/integration-auth/integration-auth-dal";
import { integrationAuthServiceFactory } from "@app/services/integration-auth/integration-auth-service";
import { incidentContactDalFactory } from "@app/services/org/incident-contacts-dal";
import { orgDalFactory } from "@app/services/org/org-dal";
import { orgRoleDalFactory } from "@app/services/org/org-role-dal";
import { orgRoleServiceFactory } from "@app/services/org/org-role-service";
import { orgServiceFactory } from "@app/services/org/org-service";
import { projectDalFactory } from "@app/services/project/project-dal";
import { projectServiceFactory } from "@app/services/project/project-service";
import { projectBotDalFactory } from "@app/services/project-bot/project-bot-dal";
import { projectBotServiceFactory } from "@app/services/project-bot/project-bot-service";
import { projectEnvDalFactory } from "@app/services/project-env/project-env-dal";
import { projectEnvServiceFactory } from "@app/services/project-env/project-env-service";
import { projectKeyDalFactory } from "@app/services/project-key/project-key-dal";
import { projectKeyServiceFactory } from "@app/services/project-key/project-key-service";
import { projectMembershipDalFactory } from "@app/services/project-membership/project-membership-dal";
import { projectMembershipServiceFactory } from "@app/services/project-membership/project-membership-service";
import { projectRoleDalFactory } from "@app/services/project-role/project-role-dal";
import { projectRoleServiceFactory } from "@app/services/project-role/project-role-service";
import { secretBlindIndexDalFactory } from "@app/services/secret/secret-blind-index-dal";
import { secretDalFactory } from "@app/services/secret/secret-dal";
import { secretServiceFactory } from "@app/services/secret/secret-service";
import { secretVersionDalFactory } from "@app/services/secret/secret-version-dal";
import { secretFolderDalFactory } from "@app/services/secret-folder/secret-folder-dal";
import { secretFolderServiceFactory } from "@app/services/secret-folder/secret-folder-service";
import { secretImportDalFactory } from "@app/services/secret-import/secret-import-dal";
import { secretImportServiceFactory } from "@app/services/secret-import/secret-import-service";
import { secretTagDalFactory } from "@app/services/secret-tag/secret-tag-dal";
import { TSmtpService } from "@app/services/smtp/smtp-service";
import { superAdminDalFactory } from "@app/services/super-admin/super-admin-dal";
import { superAdminServiceFactory } from "@app/services/super-admin/super-admin-service";
import { userDalFactory } from "@app/services/user/user-dal";
import { userServiceFactory } from "@app/services/user/user-service";

import { injectIdentity } from "../plugins/auth/inject-identity";
import { injectPermission } from "../plugins/auth/inject-permission";
import { registerV1Routes } from "./v1";
import { registerV2Routes } from "./v2";
import { registerV3Routes } from "./v3";

export const registerRoutes = async (
  server: FastifyZodProvider,
  { db, smtp: smtpService }: { db: Knex; smtp: TSmtpService }
) => {
  // db layers
  const userDal = userDalFactory(db);
  const authDal = authDalFactory(db);
  const authTokenDal = tokenDalFactory(db);
  const orgDal = orgDalFactory(db);
  const incidentContactDal = incidentContactDalFactory(db);
  const orgRoleDal = orgRoleDalFactory(db);
  const superAdminDal = superAdminDalFactory(db);
  const apiKeyDal = apiKeyDalFactory(db);

  const projectDal = projectDalFactory(db);
  const projectMembershipDal = projectMembershipDalFactory(db);
  const projectRoleDal = projectRoleDalFactory(db);
  const projectEnvDal = projectEnvDalFactory(db);
  const projectKeyDal = projectKeyDalFactory(db);
  const projectBotDal = projectBotDalFactory(db);

  const secretDal = secretDalFactory(db);
  const secretTagDal = secretTagDalFactory(db);
  const folderDal = secretFolderDalFactory(db);
  const secretImportDal = secretImportDalFactory(db);
  const secretVersionDal = secretVersionDalFactory(db);
  const secretBlindIndexDal = secretBlindIndexDalFactory(db);

  const integrationDal = integrationDalFactory(db);
  const integrationAuthDal = integrationAuthDalFactory(db);

  // ee db layer ops
  const permissionDal = permissionDalFactory(db);

  // ee services
  const permissionService = permissionServiceFactory({ permissionDal });

  // service layers
  const tokenService = tokenServiceFactory({ tokenDal: authTokenDal });
  const userService = userServiceFactory({ userDal });
  const loginService = authLoginServiceFactory({ userDal, smtpService, tokenService });
  const passwordService = authPaswordServiceFactory({
    tokenService,
    smtpService,
    authDal,
    userDal
  });
  const orgService = orgServiceFactory({
    orgRoleDal,
    permissionService,
    orgDal,
    incidentContactDal,
    tokenService,
    smtpService,
    userDal
  });
  const signupService = authSignupServiceFactory({
    tokenService,
    smtpService,
    authDal,
    userDal,
    orgDal,
    orgService
  });
  const orgRoleService = orgRoleServiceFactory({ permissionService, orgRoleDal });
  const superAdminService = superAdminServiceFactory({
    userDal,
    authService: loginService,
    serverCfgDal: superAdminDal
  });
  const apiKeyService = apiKeyServiceFactory({ apiKeyDal });

  const projectService = projectServiceFactory({
    permissionService,
    projectDal,
    secretBlindIndexDal,
    projectEnvDal,
    projectMembershipDal,
    folderDal
  });
  const projectMembershipService = projectMembershipServiceFactory({
    projectMembershipDal,
    projectDal,
    permissionService,
    orgDal,
    userDal,
    smtpService,
    projectKeyDal,
    projectRoleDal
  });
  const projectEnvService = projectEnvServiceFactory({ permissionService, projectEnvDal });
  const projectKeyService = projectKeyServiceFactory({
    permissionService,
    projectKeyDal,
    projectMembershipDal
  });
  const projectRoleService = projectRoleServiceFactory({ permissionService, projectRoleDal });

  const secretService = secretServiceFactory({
    folderDal,
    secretVersionDal,
    secretBlindIndexDal,
    permissionService,
    secretDal,
    secretTagDal
  });
  const folderService = secretFolderServiceFactory({
    permissionService,
    folderDal,
    projectEnvDal
  });
  const secretImportService = secretImportServiceFactory({
    projectEnvDal,
    folderDal,
    permissionService,
    secretImportDal
  });
  const projectBotService = projectBotServiceFactory({ permissionService, projectBotDal });
  const integrationService = integrationServiceFactory({
    permissionService,
    folderDal,
    integrationDal,
    integrationAuthDal
  });
  const integrationAuthService = integrationAuthServiceFactory({
    integrationAuthDal,
    integrationDal,
    permissionService,
    projectBotDal,
    projectBotService
  });

  await superAdminService.initServerCfg();
  // inject all services
  server.decorate<FastifyZodProvider["services"]>("services", {
    login: loginService,
    password: passwordService,
    signup: signupService,
    user: userService,
    permission: permissionService,
    org: orgService,
    orgRole: orgRoleService,
    apiKey: apiKeyService,
    authToken: tokenService,
    superAdmin: superAdminService,
    project: projectService,
    projectMembership: projectMembershipService,
    projectKey: projectKeyService,
    projectEnv: projectEnvService,
    projectRole: projectRoleService,
    secret: secretService,
    folder: folderService,
    secretImport: secretImportService,
    projectBot: projectBotService,
    integration: integrationService,
    integrationAuth: integrationAuthService
  });

  server.decorate<FastifyZodProvider["store"]>("store", {
    user: userDal
  });

  await server.register(injectIdentity);
  await server.register(injectPermission);

  server.route({
    url: "/status",
    method: "GET",
    schema: {
      response: {
        200: z.object({
          date: z.date(),
          message: z.literal("Ok"),
          emailConfigured: z.boolean().optional(),
          inviteOnlySignup: z.boolean().optional(),
          redisConfigured: z.boolean().optional(),
          secretScanningConfigured: z.boolean().optional()
        })
      }
    },
    handler: () => {
      const appCfg = getConfig();

      return {
        date: new Date(),
        message: "Ok" as const,
        emailConfigured: appCfg.isSmtpConfigured,
        inviteOnlySignup: false,
        redisConfigured: false,
        secretScanningConfigured: false
      };
    }
  });

  // register routes for v1
  await server.register(registerV1Routes, { prefix: "/v1" });
  await server.register(registerV2Routes, { prefix: "/v2" });
  await server.register(registerV3Routes, { prefix: "/v3" });

  await server.register(registerV1EERoutes, { prefix: "/ee/v1" });
};
