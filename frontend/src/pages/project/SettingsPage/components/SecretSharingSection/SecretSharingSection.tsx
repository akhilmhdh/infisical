import { createNotification } from "@app/components/notifications";
import { ProjectPermissionCan } from "@app/components/permissions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldContent,
  FieldLabel
} from "@app/components/v3";
import { ProjectPermissionActions, ProjectPermissionSub, useProject } from "@app/context";
import { useUpdateProject } from "@app/hooks/api";

export const SecretSharingSection = () => {
  const { projectId, currentProject } = useProject();

  const { mutateAsync, isPending } = useUpdateProject();

  const handleToggleSecretSharing = async (state: boolean) => {
    await mutateAsync({
      projectId,
      hasDeleteProtection: state
    });

    const text = `Successfully ${state ? "enabled" : "disabled"} secret sharing`;
    createNotification({
      text,
      type: "success"
    });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Secret Sharing</CardTitle>
      </CardHeader>
      <CardContent>
        <ProjectPermissionCan I={ProjectPermissionActions.Edit} a={ProjectPermissionSub.Settings}>
          {(isAllowed) => (
            <Field
              orientation="horizontal"
              data-disabled={!isAllowed || isPending}
              className="items-start"
            >
              <Checkbox
                id="secretSharing"
                variant="project"
                isDisabled={!isAllowed || isPending}
                isChecked={currentProject?.secretSharing ?? true}
                onCheckedChange={(state) => {
                  if (state !== "indeterminate") {
                    handleToggleSecretSharing(state);
                  }
                }}
              />
              <FieldContent>
                <FieldLabel htmlFor="secretSharing" size="sm">
                  Allows members of this project to create share links for secrets. Turning this off
                  hides the Share action and blocks new links.
                </FieldLabel>
              </FieldContent>
            </Field>
          )}
        </ProjectPermissionCan>
      </CardContent>
    </Card>
  );
};
