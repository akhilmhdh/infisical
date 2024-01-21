/* eslint-disable import/extensions */
/* eslint-disable simple-import-sort/imports */
/* eslint-disable global-require */
import type { FastifyCookieOptions } from "@fastify/cookie";
import cookie from "@fastify/cookie";
// import type { FastifyCorsOptions } from "@fastify/cors";
// import cors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import type { FastifyRateLimitOptions } from "@fastify/rate-limit";
import ratelimiter from "@fastify/rate-limit";
import fastify from "fastify";
import { Knex } from "knex";
import { Logger } from "pino";

import { TQueueServiceFactory } from "@app/queue";
import { TSmtpService } from "@app/services/smtp/smtp-service";

import { getConfig } from "@lib/config/env";

import { globalRateLimiterCfg } from "./config/rateLimiter";
import { fastifyErrHandler } from "./plugins/error-handler";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "./plugins/fastify-zod";
import { fastifyIp } from "./plugins/ip";
import { fastifySwagger } from "./plugins/swagger";
import { registerRoutes } from "./routes";
import path from "path";
// import { FastifyCorsOptions, fastifyCors } from "@fastify/cors";

type TMain = {
  db: Knex;
  smtp: TSmtpService;
  logger?: Logger;
  queue: TQueueServiceFactory;
};

// Run the server!
export const main = async ({ db, smtp, logger, queue }: TMain) => {
  const appCfg = getConfig();
  const server = fastify({
    logger,
    trustProxy: true,
    ignoreTrailingSlash: true
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  /* await server.register<FastifyCorsOptions>(fastifyCors, {
    credentials: true,
    origin: true
  });
  */

  let handler: any;

  try {
    if (process.env.STANDALONE_BUILD === "true" && appCfg.NODE_ENV === "production") {
      let nextJsBuildPath;
      let conf;
      let NextServer;
      try {
        nextJsBuildPath = path.join(__dirname, "../frontend-build");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        conf = require("../frontend-build/.next/required-server-files.json").config;
        NextServer =
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require("../frontend-build/node_modules/next/dist/server/next-server").default;
      } catch (e) {
        console.log(e);
        console.log("next server not found");
      }

      const nextApp = new NextServer({
        dev: false,
        dir: nextJsBuildPath,
        port: appCfg.PORT,
        conf,
        hostname: "local",
        customServer: false
      });

      handler = nextApp.getRequestHandler();
    }

    await server.register<FastifyCookieOptions>(cookie, {
      secret: appCfg.COOKIE_SECRET_SIGN_KEY
    });

    // pull ip based on various proxy headers
    await server.register(fastifyIp);

    await server.register(fastifySwagger);
    await server.register(fastifyFormBody);
    await server.register(fastifyErrHandler);

    // Rate limiters and security headers
    await server.register<FastifyRateLimitOptions>(ratelimiter, globalRateLimiterCfg);
    await server.register(helmet, { contentSecurityPolicy: false });
    await server.register(registerRoutes, { smtp, queue, db });

    if (handler) {
      console.log("Adding next.js handler");
      server.all("*", (req, res) => {
        handler(req.raw, res.raw);
      });
    }

    await server.ready();
    server.swagger();
    return server;
  } catch (err) {
    server.log.error(err);
    await queue.shutdown();
    process.exit(1);
  }
};
