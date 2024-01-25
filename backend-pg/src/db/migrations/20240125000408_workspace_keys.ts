import { Knex } from "knex";

import { TableName } from "../schemas";
import { createOnUpdateTrigger, dropOnUpdateTrigger } from "../utils";

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TableName.ProjectEncryptionKey))) {
    await knex.schema.createTable(TableName.ProjectEncryptionKey, (t) => {
      t.string("projectId")
        .notNullable()
        .references("id")
        .inTable(TableName.Project)
        .onDelete("CASCADE");
      t.string("projectKeyCiphertext").notNullable();
      t.string("projectKeyIV").notNullable();
      t.string("projectKeyTag").notNullable();
      t.string("algorithm").notNullable();
      t.string("keyEncoding").notNullable();
    });
  }

  if (!(await knex.schema.hasColumn(TableName.Project, "e2ee"))) {
    await knex.schema.alterTable(TableName.Project, (t) => {
      t.boolean("e2ee").defaultTo(true);
    });
  }

  await createOnUpdateTrigger(knex, TableName.ProjectEncryptionKey);
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TableName.ProjectEncryptionKey)) {
    await knex.schema.dropTable(TableName.ProjectEncryptionKey);

    await dropOnUpdateTrigger(knex, TableName.ProjectEncryptionKey);
  }

  if (await knex.schema.hasColumn(TableName.Project, "e2ee")) {
    await knex.schema.alterTable(TableName.Project, (t) => {
      t.dropColumn("e2ee");
    });
  }
}
