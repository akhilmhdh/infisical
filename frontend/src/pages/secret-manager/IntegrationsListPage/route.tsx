import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { workspaceKeys } from "@app/hooks/api";
import { TIntegration } from "@app/hooks/api/integrations/types";
import {
  fetchSecretSyncsByProjectId,
  secretSyncKeys,
  TSecretSync
} from "@app/hooks/api/secretSyncs";
import { fetchWorkspaceIntegrations } from "@app/hooks/api/workspace/queries";
import { IntegrationsListPageTabs } from "@app/types/integrations";

import { IntegrationsListPage } from "./IntegrationsListPage";

const IntegrationsListPageQuerySchema = z.object({
  selectedTab: z.nativeEnum(IntegrationsListPageTabs).optional()
});

export const Route = createFileRoute(
  "/_authenticate/_inject-org-details/_org-layout/secret-manager/$projectId/_secret-manager-layout/integrations/"
)({
  component: IntegrationsListPage,
  validateSearch: zodValidator(IntegrationsListPageQuerySchema),
  beforeLoad: async ({ context, search, params: { projectId } }) => {
    if (!search.selectedTab) {
      let secretSyncs: TSecretSync[];

      try {
        secretSyncs = await context.queryClient.ensureQueryData({
          queryKey: secretSyncKeys.list(projectId),
          queryFn: () => fetchSecretSyncsByProjectId(projectId)
        });
      } catch {
        throw redirect({
          to: "/secret-manager/$projectId/integrations",
          params: {
            projectId
          },
          search: { selectedTab: IntegrationsListPageTabs.NativeIntegrations }
        });
      }

      if (secretSyncs.length) {
        throw redirect({
          to: "/secret-manager/$projectId/integrations",
          params: {
            projectId
          },
          search: { selectedTab: IntegrationsListPageTabs.SecretSyncs }
        });
      }

      let integrations: TIntegration[];
      try {
        integrations = await context.queryClient.ensureQueryData({
          queryKey: workspaceKeys.getWorkspaceIntegrations(projectId),
          queryFn: () => fetchWorkspaceIntegrations(projectId)
        });
      } catch {
        throw redirect({
          to: "/secret-manager/$projectId/integrations",
          params: {
            projectId
          },
          search: { selectedTab: IntegrationsListPageTabs.SecretSyncs }
        });
      }

      if (integrations.length) {
        throw redirect({
          to: "/secret-manager/$projectId/integrations",
          params: {
            projectId
          },
          search: { selectedTab: IntegrationsListPageTabs.NativeIntegrations }
        });
      }

      throw redirect({
        to: "/secret-manager/$projectId/integrations",
        params: {
          projectId
        },
        search: { selectedTab: IntegrationsListPageTabs.SecretSyncs }
      });
    }

    return {
      breadcrumbs: [
        ...context.breadcrumbs,
        {
          label: "Integrations"
        }
      ]
    };
  }
});
