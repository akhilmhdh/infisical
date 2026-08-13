import { ProjectOverviewChangeSection } from "@app/components/project/ProjectOverviewChangeSection";

import { AuditLogsRetentionSection } from "../AuditLogsRetentionSection";
import { DeleteProjectProtection } from "../DeleteProjectProtection";
import { DeleteProjectSection } from "../DeleteProjectSection";
import { SecretSharingSection } from "../SecretSharingSection";

export const ProjectGeneralTab = () => {
  return (
    <div>
      <ProjectOverviewChangeSection showSlugField />
      <AuditLogsRetentionSection />
      <DeleteProjectProtection />
      <SecretSharingSection />
      <DeleteProjectSection />
    </div>
  );
};
