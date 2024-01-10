/* eslint-disable no-await-in-loop */
import { decryptSymmetric128BitHexKeyUTF8 } from "@app/lib/crypto";
import { isSamePath } from "@app/lib/fn";
import { logger } from "@app/lib/logger";
import { QueueJobs, QueueName, TQueueServiceFactory } from "@app/queue";

import { TIntegrationDalFactory } from "../integration/integration-dal";
import { TIntegrationAuthServiceFactory } from "../integration-auth/integration-auth-service";
import { syncIntegrationSecrets } from "../integration-auth/integration-sync-secret";
import { TProjectBotServiceFactory } from "../project-bot/project-bot-service";
import { TSecretFolderDalFactory } from "../secret-folder/secret-folder-dal";
import { TSecretImportDalFactory } from "../secret-import/secret-import-dal";
import { TSecretImportServiceFactory } from "../secret-import/secret-import-service";
import { TWebhookServiceFactory } from "../webhook/webhook-service";
import { TSecretDalFactory } from "./secret-dal";
import { interpolateSecrets } from "./secret-fns";

export type TSecretQueueFactory = ReturnType<typeof secretQueueFactory>;

type TSecretQueueFactoryDep = {
  queueService: TQueueServiceFactory;
  webhookService: Pick<TWebhookServiceFactory, "fnTriggerWebhook">;
  integrationDal: Pick<TIntegrationDalFactory, "findByProjectIdV2">;
  projectBotService: Pick<TProjectBotServiceFactory, "getBotKey">;
  integrationAuthService: Pick<TIntegrationAuthServiceFactory, "getIntegrationAccessToken">;
  folderDal: Pick<TSecretFolderDalFactory, "findBySecretPath">;
  secretDal: Pick<TSecretDalFactory, "findByFolderId">;
  secretImportDal: Pick<TSecretImportDalFactory, "find">;
  secretImportService: Pick<TSecretImportServiceFactory, "fnSecretsFromImports">;
};

export type TGetSecrets = {
  secretPath: string;
  projectId: string;
  environment: string;
};

export const secretQueueFactory = ({
  queueService,
  webhookService,
  integrationDal,
  projectBotService,
  integrationAuthService,
  secretDal,
  secretImportDal,
  secretImportService,
  folderDal
}: TSecretQueueFactoryDep) => {
  const syncSecrets = async (dto: TGetSecrets) => {
    queueService.queue(QueueName.SecretWebhook, QueueJobs.SecWebhook, dto, {
      jobId: `secret-webhook-${dto.environment}-${dto.projectId}-${dto.secretPath}`,
      removeOnFail: { count: 5 },
      removeOnComplete: true,
      delay: 1000,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 3000
      }
    });

    queueService.queue(QueueName.IntegrationSync, QueueJobs.IntegrationSync, dto, {
      attempts: 5,
      delay: 1000,
      backoff: {
        type: "exponential",
        delay: 3000
      },
      removeOnComplete: true,
      removeOnFail: {
        count: 5 // keep the most recent  jobs
      }
    });
  };

  const getIntegrationSecrets = async (dto: TGetSecrets & { folderId: string }, key: string) => {
    const secrets = await secretDal.findByFolderId(dto.folderId);
    if (!secrets.length) return {};

    // get imported secrets
    const secretImport = await secretImportDal.find({ folderId: dto.folderId });
    const importedSecrets = await secretImportService.fnSecretsFromImports(secretImport);
    const content: Record<
      string,
      { value: string; comment?: string; skipMultilineEncoding?: boolean }
    > = {};

    importedSecrets.forEach(({ secrets: secs }) => {
      secs.forEach((secret) => {
        const secretKey = decryptSymmetric128BitHexKeyUTF8({
          ciphertext: secret.secretKeyCiphertext,
          iv: secret.secretKeyIV,
          tag: secret.secretKeyTag,
          key
        });
        const secretValue = decryptSymmetric128BitHexKeyUTF8({
          ciphertext: secret.secretValueCiphertext,
          iv: secret.secretValueIV,
          tag: secret.secretValueTag,
          key
        });
        content[secretKey] = { value: secretValue };
        content[secretKey].skipMultilineEncoding = Boolean(secret.skipMultilineEncoding);

        if (secret.secretCommentCiphertext && secret.secretCommentIV && secret.secretCommentTag) {
          const commentValue = decryptSymmetric128BitHexKeyUTF8({
            ciphertext: secret.secretCommentCiphertext,
            iv: secret.secretCommentIV,
            tag: secret.secretCommentTag,
            key
          });
          content[secretKey].comment = commentValue;
        }
      });
    });
    secrets.forEach((secret) => {
      const secretKey = decryptSymmetric128BitHexKeyUTF8({
        ciphertext: secret.secretKeyCiphertext,
        iv: secret.secretKeyIV,
        tag: secret.secretKeyTag,
        key
      });

      const secretValue = decryptSymmetric128BitHexKeyUTF8({
        ciphertext: secret.secretValueCiphertext,
        iv: secret.secretValueIV,
        tag: secret.secretValueTag,
        key
      });

      content[secretKey] = { value: secretValue };

      if (secret.secretCommentCiphertext && secret.secretCommentIV && secret.secretCommentTag) {
        const commentValue = decryptSymmetric128BitHexKeyUTF8({
          ciphertext: secret.secretCommentCiphertext,
          iv: secret.secretCommentIV,
          tag: secret.secretCommentTag,
          key
        });
        content[secretKey].comment = commentValue;
      }

      content[secretKey].skipMultilineEncoding = Boolean(secret.skipMultilineEncoding);
    });
    const expandSecrets = interpolateSecrets({
      projectId: dto.projectId,
      secretEncKey: key,
      folderDal,
      secretDal
    });
    await expandSecrets(content);
    return content;
  };

  queueService.start(QueueName.IntegrationSync, async (job) => {
    logger.info("Secret integration sync started", job.data, job.id);
    const { environment, projectId, secretPath } = job.data;
    const folder = await folderDal.findBySecretPath(projectId, environment, secretPath);
    if (!folder) {
      logger.error("Secret path not found");
      return;
    }

    const integrations = await integrationDal.findByProjectIdV2(projectId, environment);
    const toBeSyncedIntegrations = integrations.filter(
      ({ secretPath: integrationSecPath, isActive }) =>
        isActive && isSamePath(secretPath, integrationSecPath)
    );

    for (const integration of toBeSyncedIntegrations) {
      const integrationAuth = {
        ...integration.integrationAuth,
        createdAt: new Date(),
        updatedAt: new Date(),
        projectId: integration.projectId
      };

      const botKey = await projectBotService.getBotKey(projectId);
      const { accessToken, accessId } = await integrationAuthService.getIntegrationAccessToken(
        integrationAuth,
        botKey
      );
      const secrets = await getIntegrationSecrets(
        { environment, projectId, secretPath, folderId: folder.id },
        botKey
      );
      const suffixedSecrets: typeof secrets = {};
      const metadata = integration.metadata as Record<string, any>;
      if (metadata) {
        Object.keys(secrets).forEach((key) => {
          const prefix = metadata?.secretPrefix || "";
          const suffix = metadata?.secretSuffix || "";
          const newKey = prefix + key + suffix;
          suffixedSecrets[newKey] = secrets[key];
        });
      }

      await syncIntegrationSecrets({
        integration,
        integrationAuth,
        secrets: Object.keys(suffixedSecrets).length !== 0 ? suffixedSecrets : secrets,
        accessId: accessId as string,
        accessToken,
        appendices: {
          prefix: metadata?.secretPrefix || "",
          suffix: metadata?.secretSuffix || ""
        }
      });
    }

    logger.info("Secret integration sync ended", job.id);
  });

  queueService.listen(QueueName.IntegrationSync, "failed", (job, err) => {
    logger.error("Failed to sync integration", job?.data, err);
  });

  queueService.start(QueueName.SecretWebhook, async (job) => {
    logger.info("Secret webhook job started", job.data, job.id);
    await webhookService.fnTriggerWebhook(job.data);
    logger.info("Secret webhook job ended", job.id);
  });

  return { syncSecrets };
};
