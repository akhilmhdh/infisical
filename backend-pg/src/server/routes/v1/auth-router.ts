import jwt from "jsonwebtoken";
import { z } from "zod";

import { getConfig } from "@app/lib/config/env";
import { BadRequestError, UnauthorizedError } from "@app/lib/errors";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import {
  AuthMode,
  AuthModeRefreshJwtTokenPayload,
  AuthTokenType
} from "@app/services/auth/auth-type";

export const registerAuthRoutes = async (server: FastifyZodProvider) => {
  server.route({
    url: "/logout",
    method: "POST",
    schema: {
      response: {
        200: z.object({
          message: z.string()
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: async (req, res) => {
      const appCfg = getConfig();
      if (req.auth.authMode === AuthMode.JWT) {
        await server.services.login.logout(req.auth.userId, req.auth.tokenVersionId);
      }
      res.cookie("jid", "", {
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: appCfg.HTTPS_ENABLED
      });
      return { message: "Successfully logged out" };
    }
  });

  server.route({
    url: "/checkAuth",
    method: "POST",
    schema: {
      response: {
        200: z.object({
          message: z.literal("Authenticated")
        })
      }
    },
    onRequest: verifyAuth([AuthMode.JWT]),
    handler: () => ({ message: "Authenticated" as const })
  });

  server.route({
    url: "/token",
    method: "POST",
    schema: {
      response: {
        200: z.object({
          token: z.string()
        })
      }
    },
    handler: async (req) => {
      const refreshToken = req.cookies.jid;
      const appCfg = getConfig();
      if (!refreshToken)
        throw new BadRequestError({
          name: "Auth token route",
          message: "Failed  to find refresh token"
        });

      const decodedToken = jwt.verify(
        refreshToken,
        appCfg.JWT_AUTH_SECRET
      ) as AuthModeRefreshJwtTokenPayload;
      if (decodedToken.authTokenType !== AuthTokenType.REFRESH_TOKEN)
        throw new UnauthorizedError({ message: "Invalid token", name: "Auth token route" });

      const tokenVersion = await server.services.authToken.getUserTokenSessionById(
        decodedToken.tokenVersionId,
        decodedToken.userId
      );
      if (!tokenVersion)
        throw new UnauthorizedError({ message: "Invalid token", name: "Auth token route" });

      if (decodedToken.refreshVersion !== tokenVersion.refreshVersion)
        throw new UnauthorizedError({ message: "Invalid token", name: "Auth token route" });

      const token = jwt.sign(
        {
          authTokenType: AuthTokenType.ACCESS_TOKEN,
          userId: decodedToken.userId,
          tokenVersionId: tokenVersion.id,
          accessVersion: tokenVersion.accessVersion
        },
        appCfg.JWT_AUTH_SECRET,
        { expiresIn: appCfg.JWT_AUTH_LIFETIME }
      );

      return { token };
    }
  });
};
