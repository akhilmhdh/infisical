import { SecretKeyEncoding } from "@app/db/schemas";
import {
  encryptSymmetric128BitHexKeyUTF8,
  infisicalSymmetricDecrypt,
  infisicalSymmetricEncypt
} from "@app/lib/crypto/encryption";
import { daysToMillisecond } from "@app/lib/dates";
import { logger } from "@app/lib/logger";
import { alphaNumericNanoId } from "@app/lib/nanoid";
import { QueueJobs, QueueName, TQueueServiceFactory } from "@app/queue";
import { TProjectBotServiceFactory } from "@app/services/project-bot/project-bot-service";
import { TSecretDalFactory } from "@app/services/secret/secret-dal";
import { TSecretVersionDalFactory } from "@app/services/secret/secret-version-dal";

import { TSecretRotationDalFactory } from "../secret-rotation-dal";
import { rotationTemplates } from "../templates";
import { TProviderFunctionTypes, TSecretRotationProviderTemplate } from "../templates/types";
import {
  getDbSetQuery,
  secretRotationDbFn,
  secretRotationHttpFn,
  secretRotationHttpSetFn,
  secretRotationPreSetFn
} from "./secret-rotation-queue-fn";
import {
  TSecretRotationData,
  TSecretRotationDbFn,
  TSecretRotationEncData
} from "./secret-rotation-queue-types";

export type TSecretRotationQueueFactory = ReturnType<typeof secretRotationQueueFactory>;

type TSecretRotationQueueFactoryDep = {
  queue: TQueueServiceFactory;
  secretRotationDal: TSecretRotationDalFactory;
  projectBotService: Pick<TProjectBotServiceFactory, "getBotKey">;
  secretDal: Pick<TSecretDalFactory, "bulkUpdate">;
  secretVersionDal: Pick<TSecretVersionDalFactory, "insertMany" | "findLatestVersionMany">;
};

// These error should stop the repeatable job and ask user to reconfigure rotation
export class DisableRotationErrors extends Error {
  name: string;

  error: unknown;

  constructor({ name, error, message }: { message: string; name?: string; error?: unknown }) {
    super(message);
    this.name = name || "DisableRotationErrors";
    this.error = error;
  }
}

export const secretRotationQueueFactory = ({
  queue,
  secretRotationDal,
  projectBotService,
  secretDal,
  secretVersionDal
}: TSecretRotationQueueFactoryDep) => {
  const addToQueue = async (rotationId: string, interval: number) =>
    queue.queue(
      QueueName.SecretRotation,
      QueueJobs.SecretRotation,
      { rotationId },
      { jobId: rotationId, repeat: { every: daysToMillisecond(interval), immediately: true } }
    );

  const removeFromQueue = async (rotationId: string) =>
    queue.stopRepeatableJob(QueueName.SecretRotation, rotationId);

  queue.start(QueueName.SecretRotation, async (job) => {
    const { rotationId } = job.data;
    logger.info(`secretRotationQueue.process: [rotationDocument=${rotationId}]`);
    const secretRotation = await secretRotationDal.findById(rotationId);
    const rotationProvider = rotationTemplates.find(
      ({ name }) => name === secretRotation?.provider
    );

    try {
      if (!rotationProvider || !secretRotation)
        throw new DisableRotationErrors({ message: "Provider not found" });

      const rotationOutputs = await secretRotationDal.findRotationOutputsByRotationId(rotationId);
      if (!rotationOutputs.length)
        throw new DisableRotationErrors({ message: "Secrets not found" });

      // deep copy
      const provider = JSON.parse(
        JSON.stringify(rotationProvider)
      ) as TSecretRotationProviderTemplate;

      // now get the encrypted variable values
      // in includes the inputs, the previous outputs
      // internal mapping variables etc
      const { encryptedDataTag, encryptedDataIV, encryptedData, keyEncoding } = secretRotation;
      if (!encryptedDataTag || !encryptedDataIV || !encryptedData || !keyEncoding) {
        throw new DisableRotationErrors({ message: "No inputs found" });
      }
      const decryptedData = infisicalSymmetricDecrypt({
        keyEncoding: keyEncoding as SecretKeyEncoding,
        ciphertext: encryptedData,
        iv: encryptedDataIV,
        tag: encryptedDataTag
      });

      const variables = JSON.parse(decryptedData) as TSecretRotationEncData;
      // rotation set cycle
      const newCredential: TSecretRotationData = {
        inputs: variables.inputs,
        outputs: {},
        internal: {}
      };

      // when its a database we keep cycling the variables accordingly
      if (provider.template.type === TProviderFunctionTypes.DB) {
        const lastCred = variables.creds.at(-1);
        if (lastCred && variables.creds.length === 1) {
          newCredential.internal.username =
            lastCred.internal.username === variables.inputs.username1
              ? variables.inputs.username2
              : variables.inputs.username1;
        } else {
          newCredential.internal.username = lastCred
            ? lastCred.internal.username
            : variables.inputs.username1;
        }
        // set a random value for new password
        newCredential.internal.rotated_password = alphaNumericNanoId(32);
        const { username, password, host, database, port, ca } = newCredential.inputs;
        const dbFunctionArg = {
          username,
          password,
          host,
          database,
          port,
          ca: ca as string,
          client: provider.template.client
        } as TSecretRotationDbFn;
        // set function
        await secretRotationDbFn({
          ...dbFunctionArg,
          ...getDbSetQuery(provider.template.client, {
            password: newCredential.internal.rotated_password as string,
            username: newCredential.internal.username as string
          })
        });
        // test function
        await secretRotationDbFn({
          ...dbFunctionArg,
          query: "SELECT NOW()",
          variables: {}
        });
        // clean up
        if (variables.creds.length === 2) variables.creds.pop();
      }

      if (provider.template.type === TProviderFunctionTypes.HTTP) {
        if (provider.template.functions.set?.pre) {
          secretRotationPreSetFn(provider.template.functions.set.pre, newCredential);
        }
        await secretRotationHttpSetFn(provider.template.functions.set, newCredential);
        // now test
        await secretRotationHttpFn(provider.template.functions.test, newCredential);
        if (variables.creds.length === 2) {
          const deleteCycleCred = variables.creds.pop();
          if (deleteCycleCred && provider.template.functions.remove) {
            const deleteCycleVar = { inputs: variables.inputs, ...deleteCycleCred };
            if (provider.template.type === TProviderFunctionTypes.HTTP) {
              await secretRotationHttpFn(provider.template.functions.remove, deleteCycleVar);
            }
          }
        }
      }

      variables.creds.unshift({
        outputs: newCredential.outputs,
        internal: newCredential.internal
      });
      const encVarData = infisicalSymmetricEncypt(JSON.stringify(variables));
      const key = await projectBotService.getBotKey(secretRotation.projectId);
      const encryptedSecrets = rotationOutputs.map(({ key: outputKey, secretId }) => ({
        secretId,
        value: encryptSymmetric128BitHexKeyUTF8(
          typeof newCredential.outputs[outputKey] === "object"
            ? JSON.stringify(newCredential.outputs[outputKey])
            : String(newCredential.outputs[outputKey]),
          key
        )
      }));
      await secretRotationDal.transaction(async (tx) => {
        await secretRotationDal.updateById(
          rotationId,
          {
            encryptedData: encVarData.ciphertext,
            encryptedDataIV: encVarData.iv,
            encryptedDataTag: encVarData.tag,
            keyEncoding: encVarData.encoding,
            algorithm: encVarData.algorithm,
            lastRotatedAt: new Date(),
            statusMessage: "Rotated successfull",
            status: "success"
          },
          tx
        );
        const updatedSecrets = await secretDal.bulkUpdate(
          encryptedSecrets.map(({ secretId, value }) => ({
            id: secretId,
            secretValueCiphertext: value.ciphertext,
            secretValueIV: value.iv,
            secretValueTag: value.tag
          })),
          tx
        );
        await secretDal.bulkUpdate(
          updatedSecrets.map(({ id, version }) => ({ id, version: (version || 0) + 1 })),
          tx
        );
        await secretVersionDal.insertMany(
          updatedSecrets.map(({ id, updatedAt, createdAt, ...el }) => ({
            ...el,
            secretId: id
          })),
          tx
        );
      });
    } catch (error) {
      if (error instanceof DisableRotationErrors) {
        if (job.id) {
          queue.stopRepeatableJob(QueueName.SecretRotation, job.id);
        }
      }

      await secretRotationDal.updateById(rotationId, {
        status: "failed",
        statusMessage: (error as Error).message.slice(0, 500),
        lastRotatedAt: new Date()
      });
    }
  });

  return {
    addToQueue,
    removeFromQueue
  };
};