import { faGlobe, faPencil, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { createNotification } from "@app/components/notifications";
import { UpgradePlanModal } from "@app/components/license/UpgradePlanModal";
import { ProjectPermissionCan } from "@app/components/permissions";
import {
  EmptyState,
  IconButton,
  Table,
  TableContainer,
  TableSkeleton,
  TBody,
  Td,
  Th,
  THead,
  Tr
} from "@app/components/v2";
import {
  ProjectPermissionActions,
  ProjectPermissionSub,
  useProject,
  useSubscription
} from "@app/context";
import { useGetTrustedIps, useUpdateTrustedIp } from "@app/hooks/api";
import { UsePopUpState } from "@app/hooks/usePopUp";

import { Switch } from "@app/components/v3";

type Props = {
  popUp: UsePopUpState<["upgradePlan"]>;
  handlePopUpOpen: (
    popUpName: keyof UsePopUpState<["trustedIp", "deleteTrustedIp", "upgradePlan"]>,
    data?: {
      trustedIpId: string;
      ipAddress?: string;
      comment?: string;
      isActive?: boolean;
      prefix?: number;
    }
  ) => void;
  handlePopUpToggle: (popUpName: keyof UsePopUpState<["upgradePlan"]>, state?: boolean) => void;
};

export const IPAllowlistTable = ({ popUp, handlePopUpOpen, handlePopUpToggle }: Props) => {
  const { subscription } = useSubscription();
  const { currentProject } = useProject();
  const { mutateAsync: updateTrustedIp } = useUpdateTrustedIp();

  const handleToggleActive = async (
    trustedIpId: string,
    ipAddress: string,
    comment: string,
    isActive: boolean
  ) => {
    await updateTrustedIp({
      projectId: currentProject.id,
      trustedIpId,
      ipAddress,
      comment,
      isActive: !isActive
    });
    createNotification({ type: "success", text: `IP ${!isActive ? "enabled" : "disabled"}` });
  };

  const { data, isPending } = useGetTrustedIps(currentProject?.id ?? "");

  const formatType = (type: string, prefix?: number) => {
    return `${type.slice(0, 2).toUpperCase() + type.slice(2)} ${
      prefix !== undefined ? "CIDR" : ""
    }`;
  };

  return (
    <div>
      <TableContainer className="mt-4">
        <Table>
          <THead>
            <Tr>
              <Th className="flex-1">IP Address / Range</Th>
              <Th className="flex-1">Format</Th>
              <Th className="flex-1">Comment</Th>
              <Th className="flex-1">Status</Th>
              <Th className="w-5" />
            </Tr>
          </THead>
          <TBody>
            {!isPending &&
              data &&
              data?.length > 0 &&
              data
                .sort((a, b) => a.ipAddress.localeCompare(b.ipAddress))
                .map(({ id, ipAddress, comment, type, prefix, isActive }) => {
                  return (
                    <Tr key={`ip-access-range-${id}`} className="h-10">
                      <Td>{`${ipAddress}${prefix !== undefined ? `/${prefix}` : ""}`}</Td>
                      <Td>{formatType(type, prefix)}</Td>
                      <Td>{comment}</Td>
                      <Td>
                        <ProjectPermissionCan
                          I={ProjectPermissionActions.Edit}
                          a={ProjectPermissionSub.IpAllowList}
                        >
                          {(isAllowed) => (
                            <Switch
                              id={`ip-active-${id}`}
                              aria-label={`toggle-ip-${ipAddress}`}
                              checked={isActive ?? true}
                              disabled={!isAllowed}
                              onCheckedChange={() =>
                                handleToggleActive(id, ipAddress, comment ?? "", isActive ?? true)
                              }
                            />
                          )}
                        </ProjectPermissionCan>
                      </Td>
                      <Td className="flex items-center">
                        <ProjectPermissionCan
                          I={ProjectPermissionActions.Edit}
                          a={ProjectPermissionSub.IpAllowList}
                        >
                          {(isAllowed) => (
                            <IconButton
                              className="mr-3 py-2"
                              onClick={() => {
                                if (subscription?.ipAllowlisting) {
                                  handlePopUpOpen("trustedIp", {
                                    trustedIpId: id,
                                    ipAddress,
                                    comment,
                                    prefix,
                                    isActive
                                  });
                                } else {
                                  handlePopUpOpen("upgradePlan");
                                }
                              }}
                              colorSchema="primary"
                              variant="plain"
                              ariaLabel="update"
                              isDisabled={!isAllowed}
                            >
                              <FontAwesomeIcon icon={faPencil} />
                            </IconButton>
                          )}
                        </ProjectPermissionCan>
                        <ProjectPermissionCan
                          I={ProjectPermissionActions.Delete}
                          a={ProjectPermissionSub.IpAllowList}
                        >
                          {(isAllowed) => (
                            <IconButton
                              onClick={() => {
                                if (subscription?.ipAllowlisting) {
                                  handlePopUpOpen("deleteTrustedIp", {
                                    trustedIpId: id
                                  });
                                } else {
                                  handlePopUpOpen("upgradePlan");
                                }
                              }}
                              size="lg"
                              colorSchema="danger"
                              variant="plain"
                              ariaLabel="update"
                              isDisabled={!isAllowed}
                            >
                              <FontAwesomeIcon icon={faXmark} />
                            </IconButton>
                          )}
                        </ProjectPermissionCan>
                      </Td>
                    </Tr>
                  );
                })}
            {isPending && (
              <TableSkeleton innerKey="ip-access-table" columns={4} key="ip-access-ranges" />
            )}
            {!isPending && data && data?.length === 0 && (
              <Tr>
                <Td colSpan={5}>
                  <EmptyState title="No IP addresses added" icon={faGlobe} />
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </TableContainer>
      <UpgradePlanModal
        isOpen={popUp.upgradePlan.isOpen}
        onOpenChange={(isOpen) => handlePopUpToggle("upgradePlan", isOpen)}
        text="Your current plan does not include access to IP allowlisting. To unlock this feature, please upgrade to Infisical Pro plan."
      />
    </div>
  );
};
