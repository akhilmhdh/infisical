/* eslint-disable import/no-dynamic-require */
/* eslint-disable import/extensions */
/* eslint-disable global-require */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable prefer-rest-params */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable func-names */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-param-reassign */
import fastifyStatic from "@fastify/static";
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { LogLevel } from "fastify/types/logger";
import fastifyPlugin from "fastify-plugin";
import { IncomingMessage, ServerResponse } from "http";
import path from "path";

import { getConfig } from "@lib/config/env";

export interface FastifyNextJsDecoratorArguments {
  logLevel?: LogLevel;
}

declare module "fastify" {
  // eslint-disable-next-line no-unused-vars
  // noinspection JSUnusedGlobalSymbols
  interface FastifyInstance {
    nextJsProxyRequestHandler: (request: FastifyRequest, reply: FastifyReply) => void;
    nextJsRawRequestHandler: (request: FastifyRequest, reply: FastifyReply) => void;
    nextServer: any;
    passNextJsRequests: (args?: FastifyNextJsDecoratorArguments) => void;
    passNextJsDataRequests: (args?: FastifyNextJsDecoratorArguments) => void;
    passNextJsDevRequests: (args?: FastifyNextJsDecoratorArguments) => void;
    passNextJsImageRequests: (args?: FastifyNextJsDecoratorArguments) => void;
    passNextJsPageRequests: (args?: FastifyNextJsDecoratorArguments) => void;
    passNextJsStaticRequests: (args?: FastifyNextJsDecoratorArguments) => void;
  }
}

declare module "http" {
  // eslint-disable-next-line no-unused-vars
  interface IncomingMessage {
    fastify: FastifyRequest;
  }

  // eslint-disable-next-line no-unused-vars
  interface OutgoingMessage {
    fastify: FastifyReply;
  }
}

export interface FastifyNextJsOptions {
  dev?: boolean;
  dir?: string;
  basePath?: string;
}

const fastifyNextJs: FastifyPluginAsync = async (fastify) => {
  const appCfg = getConfig();

  let nextJsBuildPath: string | null = null;
  let NextServer: any = null;
  let conf: any = null;
  try {
    nextJsBuildPath = path.join(__dirname, "../frontend-build");
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    conf = require(`../frontend-build/.next/required-server-files.json`).config;

    NextServer =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(`../frontend-build/node_modules/next/dist/server/next-server`).default;
  } catch (e) {
    console.log(e);
    console.log("next server not found");
  }

  const nextServer = new NextServer({
    dev: false,
    dir: nextJsBuildPath,
    port: appCfg.PORT,
    conf,
    hostname: "local",
    customServer: false
  });

  console.log("next server created!");

  const nextJsProxyRequestHandler = function (request: FastifyRequest, reply: FastifyReply) {
    console.log("1");
    const proxiedRequst = proxyFastifyRawRequest(request);
    console.log("2");
    const proxiedReply = proxyFastifyRawReply(reply);
    console.log("3");

    console.log("started proxy request handler");
    nextServer.getRequestHandler()(proxiedRequst, proxiedReply);
    console.log("finished proxy request handler");
  };

  const nextJsRawRequestHandler = function (request: FastifyRequest, reply: FastifyReply) {
    nextServer.getRequestHandler()(request.raw, reply.raw);
  };

  const passNextJsRequestsDecorator = (args?: FastifyNextJsDecoratorArguments) => {
    fastify.passNextJsDataRequests(args);
    fastify.passNextJsImageRequests(args);

    fastify.passNextJsStaticRequests(args);

    fastify.passNextJsPageRequests(args);
  };

  const passNextJsDataRequestsDecorator = async ({
    logLevel
  }: FastifyNextJsDecoratorArguments = {}) => {
    await fastify.register(
      (fastify, _, done) => {
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "/data/*",
          handler: nextJsProxyRequestHandler
        });
        console.log("✅ passNextJsDataRequestsDecorator registered"); // WORKS!!!
        done();
      },
      {
        logLevel,
        prefix: `/_next`
      }
    );
  };

  const passNextJsDevRequestsDecorator = async ({
    logLevel
  }: FastifyNextJsDecoratorArguments = {}) => {
    await fastify.register(
      (fastify, _, done) => {
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "/static/*",
          handler: nextJsRawRequestHandler
        });
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "/webpack-hmr",
          handler: nextJsRawRequestHandler
        });

        console.log("passNextJsDevRequestsDecorator registered"); // DOES NOT WORK
        done();
      },
      {
        logLevel,
        prefix: `/_next`
      }
    );
  };

  const passNextJsImageRequestsDecorator = async ({
    logLevel
  }: FastifyNextJsDecoratorArguments = {}) => {
    await fastify.register(
      (fastify, _, done) => {
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "/image",
          handler: nextJsRawRequestHandler
        });

        console.log("✅ passNextJsImageRequestsDecorator registered");
        done();
      },
      {
        logLevel,
        prefix: `/_next`
      }
    );
  };

  const passNextJsStaticRequestsDecorator = ({
    logLevel
  }: FastifyNextJsDecoratorArguments = {}) => {
    fastify.register(fastifyStatic, {
      logLevel,
      prefix: `/_next/static/`,
      root: `${path.join(__dirname, "../frontend-build/.next/static")}`,
      decorateReply: false
    });
  };

  const passNextJsPageRequestsDecorator = async ({
    logLevel
  }: FastifyNextJsDecoratorArguments = {}) => {
    await fastify.register(
      (fastify, _, done) => {
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "*",
          handler: nextJsProxyRequestHandler
        });

        console.log("✅ passNextJsPageRequestsDecorator registered"); // DOES NOT WORK
        done();
      },
      {
        logLevel,
        prefix: "/"
      }
    );
  };

  fastify.decorate("nextJsProxyRequestHandler", nextJsProxyRequestHandler);
  fastify.decorate("nextJsRawRequestHandler", nextJsRawRequestHandler);
  fastify.decorate("nextServer", nextServer);
  fastify.decorate("passNextJsDataRequests", passNextJsDataRequestsDecorator);
  fastify.decorate("passNextJsDevRequests", passNextJsDevRequestsDecorator);
  fastify.decorate("passNextJsImageRequests", passNextJsImageRequestsDecorator);
  fastify.decorate("passNextJsPageRequests", passNextJsPageRequestsDecorator);
  fastify.decorate("passNextJsRequests", passNextJsRequestsDecorator);
  fastify.decorate("passNextJsStaticRequests", passNextJsStaticRequestsDecorator);

  await nextServer.prepare();

  fastify.addHook("onClose", () => nextServer.close());
};

const proxyFastifyRawRequest = (request: FastifyRequest) =>
  new Proxy(request.raw, {
    get(target: IncomingMessage, property: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, property, receiver);

      if (typeof value === "function") {
        return value.bind(target);
      }

      if (property === "fastify") {
        return request;
      }

      return value;
    }
  });

const proxyFastifyRawReply = (reply: FastifyReply) =>
  new Proxy(reply.raw, {
    get(target: ServerResponse, property: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(target, property, receiver);

      if (typeof value === "function") {
        if (value.name === "end") {
          return function () {
            return reply.send(arguments[0]);
          };
        }
        if (value.name === "getHeader") {
          return function () {
            return reply.getHeader(arguments[0]);
          };
        }
        if (value.name === "hasHeader") {
          return function () {
            return reply.hasHeader(arguments[0]);
          };
        }
        if (value.name === "setHeader") {
          return function () {
            return reply.header(arguments[0], arguments[1]);
          };
        }
        if (value.name === "writeHead") {
          return function () {
            return reply.status(arguments[0]);
          };
        }
        return value.bind(target);
      }

      if (property === "fastify") {
        return reply;
      }

      return value;
    }
  });

export default fastifyPlugin(fastifyNextJs, {
  fastify: "4.x",
  name: "serve-next"
});
