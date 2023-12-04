import dotenv from "dotenv";
import type { Knex } from "knex";
import path from "path";

// eslint-disable-next-line
import "ts-node/register";

// Update with your config settings.
dotenv.config({
  path: path.join(__dirname, "../../.env"),
  debug: true
});
export default {
  useNullAsDefault: true,
  client: "postgres",
  connection: process.env.DB_CONNECTION_URI,
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    tableName: "infisical_migrations"
  }
} as Knex.Config;
