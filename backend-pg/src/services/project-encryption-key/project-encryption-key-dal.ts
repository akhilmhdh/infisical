import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { DatabaseError } from "@app/lib/errors";
import { ormify } from "@app/lib/knex";

export type TProjectEncryptionKeyDALFactory = ReturnType<typeof projectEncryptionKeyDALFactory>;

export const projectEncryptionKeyDALFactory = (db: TDbClient) => {
  const projectEncryptionKey = ormify(db, TableName.ProjectEncryptionKey);

  const findByProjectId = async (projectId: string) => {
    try {
      const encryptionKey = await db(TableName.ProjectEncryptionKey).where({ projectId }).first();
      return encryptionKey;
    } catch (error) {
      throw new DatabaseError({ error, name: "Find project encryption key by project id" });
    }
  };

  return {
    ...projectEncryptionKey,
    findByProjectId
  };
};
