import { createFileRoute } from "@tanstack/react-router";

import { DynamicSecretRdpScreenPage } from "./DynamicSecretRdpScreenPage";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";

const querySchema = z.object({
  dynamicSecretName: z.string(),
  environment: z.string(),
  secretPath: z.string()
});

export const Route = createFileRoute(
  "/_authenticate/_inject-org-details/_org-layout/secret-manager/$projectId/rdp-screen"
)({
  component: DynamicSecretRdpScreenPage,
  validateSearch: zodValidator(querySchema)
});
