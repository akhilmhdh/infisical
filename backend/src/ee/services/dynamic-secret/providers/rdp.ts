import { customAlphabet } from "nanoid";
import { z } from "zod";
import rdp from "node-rdpjs";

import { alphaNumericNanoId } from "@app/lib/nanoid";

import { verifyHostInputValidity } from "../dynamic-secret-fns";
import { DynamicSecretRdpSchema, TDynamicProviderFns } from "./models";
import { compileUsernameTemplate } from "./templateUtils";

const generatePassword = (size = 48) => {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!*";
  return customAlphabet(charset, 48)(size);
};

const generateUsername = (usernameTemplate?: string | null, identity?: { name: string }) => {
  const randomUsername = alphaNumericNanoId(32); // Username must start with an ascii letter, so we prepend the username with "inf-"
  if (!usernameTemplate) return randomUsername;
  return compileUsernameTemplate({
    usernameTemplate,
    randomUsername,
    identity
  });
};

export const RdpProvider = (): TDynamicProviderFns => {
  const validateProviderInputs = async (inputs: unknown) => {
    const providerInputs = await DynamicSecretRdpSchema.parseAsync(inputs);
    const hostIps = await Promise.all(
      providerInputs.host
        .split(",")
        .filter(Boolean)
        .map((el) => verifyHostInputValidity(el).then((ip) => ip[0]))
    );

    return { ...providerInputs, hostIps };
  };

  const $getClient = (providerInputs: z.infer<typeof DynamicSecretRdpSchema>) => {
    // const sslOptions = providerInputs.ca ? { rejectUnauthorized: false, ca: providerInputs.ca } : undefined;
    const client = rdp.createClient({
      domain: providerInputs.host,
      userName: providerInputs.username,
      password: providerInputs.password,
      enablePerf: true,
      autoLogin: true,
      screen: true,
      locale: "en",
      screen: { width: 800, height: 600 },
      logLevel: "INFO"
    });
    return client;
  };

  const validateConnection = async (inputs: unknown) => {
    const providerInputs = await validateProviderInputs(inputs);
    await new Promise((resolve, reject) => {
      const rdpClient = $getClient(providerInputs)
        .connect(providerInputs.host, providerInputs.port)
        .on("connect", () => {
          rdpClient.close();
          resolve(true);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
    return true;
  };

  const create = async (data: {
    inputs: unknown;
    expireAt: number;
    usernameTemplate?: string | null;
    identity?: { name: string };
  }) => {
    const { usernameTemplate, identity } = data;
    const username = generateUsername(usernameTemplate, identity);
    const password = generatePassword();

    return { entityId: username, data: { DB_USERNAME: username, DB_PASSWORD: password } };
  };

  const revoke = async (_inputs: unknown, entityId: string) => {
    const username = entityId;

    return { entityId: username };
  };

  const renew = async (_inputs: unknown, entityId: string) => {
    return { entityId };
  };

  return {
    validateProviderInputs,
    validateConnection,
    create,
    revoke,
    renew
  };
};
