import { SecretKeyEncoding } from "@app/db/schemas";
import { infisicalSymmetricDecrypt } from "@app/lib/crypto/encryption";
import { BadRequestError } from "@app/lib/errors";

import { TProjectDALFactory } from "../project/project-dal";
import { TProjectBotServiceFactory } from "../project-bot/project-bot-service";
import { TProjectEncryptionKeyDALFactory } from "./project-encryption-key-dal";

type TProjectEncryptionKeyServiceFactoryDep = {
  projectEncryptionKeyDAL: TProjectEncryptionKeyDALFactory;
  projectBotService: TProjectBotServiceFactory;
  projectDAL: TProjectDALFactory;
};

export type TProjectEncryptionKeyServiceFactory = ReturnType<
  typeof projectEncryptionKeyServiceFactory
>;

export const projectEncryptionKeyServiceFactory = ({
  projectDAL,
  projectBotService,
  projectEncryptionKeyDAL
}: TProjectEncryptionKeyServiceFactoryDep) => {
  const getRawEncryptionKey = async (projectId: string) => {
    const project = await projectDAL.findById(projectId);

    // If e2ee is fully disabled, we'll get the key from storage
    if (!project.e2ee) {
      const storedKey = await projectEncryptionKeyDAL.findByProjectId(projectId);

      if (!storedKey) {
        throw new BadRequestError({ message: "No encryption key found for this project" });
      }

      const key = infisicalSymmetricDecrypt({
        keyEncoding: storedKey.keyEncoding as SecretKeyEncoding,
        ciphertext: storedKey.projectKeyCiphertext,
        iv: storedKey.projectKeyIV,
        tag: storedKey.projectKeyTag
      });

      return key;
    }

    const botKey = await projectBotService.getBotKey(projectId);

    return botKey;
  };

  return {
    getRawEncryptionKey
  };
};
