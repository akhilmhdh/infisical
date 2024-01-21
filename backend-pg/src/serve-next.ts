/* eslint-disable no-template-curly-in-string */
/* eslint-disable prefer-arrow-callback */
/* eslint-disable arrow-body-style */
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
  interface FastifyInstance {
    nextJsProxyRequestHandler: (request: FastifyRequest, reply: FastifyReply) => void;
    nextJsRawRequestHandler: (request: FastifyRequest, reply: FastifyReply) => void;
    nextServer: any;
    passNextJsRequests: () => void;
    passNextJsImageRequests: () => void;
    passNextJsDataRequests: () => void;
    passNextJsDevRequests: () => void;
    passNextJsPageRequests: () => void;
    passNextJsStaticRequests: () => void;
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
  basePath?: string;
}

const fastifyNextJs: FastifyPluginAsync<FastifyNextJsOptions> = async (
  fastify,
  { dev, basePath = "" }
) => {
  if (dev === undefined) {
    dev = process.env.NODE_ENV !== "production";
  }

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

  const nextRequestHandler = nextServer.getRequestHandler();

  const passNextJsRequestsDecorator = () => {
    fastify.passNextJsDataRequests();
    fastify.passNextJsImageRequests();

    if (dev) {
      fastify.passNextJsDevRequests();
    } else {
      fastify.passNextJsStaticRequests();
    }

    fastify.passNextJsPageRequests();
  };

  const passNextJsDataRequestsDecorator = () => {
    fastify.get(`${basePath}/_next/data/*`, nextJsProxyRequestHandler);
  };

  const passNextJsDevRequestsDecorator = () => {
    fastify.all(`${basePath}/_next/*`, nextJsRawRequestHandler);
  };

  const passNextJsStaticRequestsDecorator = () => {
    fastify.register(fastifyStatic, {
      prefix: `${basePath}/_next/static/`,
      root: `${path.join(__dirname, "../frontend-build/.next/static")}`,
      decorateReply: false
    });
  };

  const passNextJsImageRequestsDecorator = () => {
    fastify.register(
      (fastify, _, done) => {
        fastify.route({
          method: ["GET", "HEAD", "OPTIONS"],
          url: "/images/*",
          handler: nextJsRawRequestHandler
        });
        done();
      },
      {
        prefix: `${basePath}/_next`
      }
    );
  };

  const passNextJsPageRequestsDecorator = () => {
    if (basePath) {
      fastify.all(`${basePath}`, nextJsProxyRequestHandler);
    }
    fastify.all(`/*`, nextJsProxyRequestHandler);
  };
  fastify.decorate("passNextJsRequests", passNextJsRequestsDecorator);
  fastify.decorate("passNextJsDataRequests", passNextJsDataRequestsDecorator);
  fastify.decorate("passNextJsDevRequests", passNextJsDevRequestsDecorator);
  fastify.decorate("passNextJsStaticRequests", passNextJsStaticRequestsDecorator);
  fastify.decorate("passNextJsPageRequests", passNextJsPageRequestsDecorator);
  fastify.decorate("passNextJsImageRequests", passNextJsImageRequestsDecorator);
  fastify.decorate("nextServer", nextServer);

  const nextJsProxyRequestHandler = function (request: FastifyRequest, reply: FastifyReply) {
    nextRequestHandler(proxyFastifyRawRequest(request), proxyFastifyRawReply(reply));
  };

  const nextJsRawRequestHandler = function (request: FastifyRequest, reply: FastifyReply) {
    nextRequestHandler(request.raw, reply.raw);
  };

  fastify.decorate("nextJsProxyRequestHandler", nextJsProxyRequestHandler);
  fastify.decorate("nextJsRawRequestHandler", nextJsRawRequestHandler);

  fastify.addHook("onClose", function () {
    return nextServer.close();
  });

  await nextServer.prepare();
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

const proxyFastifyRawReply = (reply: FastifyReply) => {
  return new Proxy(reply.raw, {
    // eslint-disable-next-line object-shorthand
    get: function (target: ServerResponse, property: string | symbol, receiver: unknown): unknown {
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
};

export default fastifyPlugin(fastifyNextJs, {
  fastify: "4.x",
  name: "serve-next"
});
