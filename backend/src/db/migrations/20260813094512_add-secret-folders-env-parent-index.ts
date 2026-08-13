import { Knex } from "knex";

import { TableName } from "../schemas";

// The folder listing for a dashboard page filters on (envId, parentId) on every load. Postgres does not
// index that pair today, so the lookup is a sequential scan of secret_folders.
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TableName.SecretFolder);
  if (!hasTable) return;

  await knex.schema.alterTable(TableName.SecretFolder, (t) => {
    t.index(["envId", "parentId"], "secret_folders_env_id_parent_id_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TableName.SecretFolder);
  if (!hasTable) return;

  await knex.schema.alterTable(TableName.SecretFolder, (t) => {
    t.dropIndex(["envId", "parentId"], "secret_folders_env_id_parent_id_index");
  });
}
