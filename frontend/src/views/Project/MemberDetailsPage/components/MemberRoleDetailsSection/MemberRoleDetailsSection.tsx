import { createNotification } from "@app/components/notifications";
import { ProjectPermissionCan } from "@app/components/permissions";
import {
  DeleteActionModal,
  IconButton,
  TableContainer,
  Td,
  Table,
  Tr,
  Th,
  THead,
  TableSkeleton,
  EmptyState,
  TBody,
  Tooltip,
  Modal,
  ModalContent,
  Tag
} from "@app/components/v2";
import {
  ProjectPermissionActions,
  ProjectPermissionSub,
  useUser,
  useWorkspace
} from "@app/context";
import { formatProjectRoleName } from "@app/helpers/roles";
import { usePopUp } from "@app/hooks";
import { useUpdateUserWorkspaceRole } from "@app/hooks/api";
import { TProjectRole } from "@app/hooks/api/roles/types";
import { TWorkspaceUser } from "@app/hooks/api/types";
import { faFolder, faPencil, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { format, formatDistance } from "date-fns";
import { twMerge } from "tailwind-merge";
import { MemberRoleModify } from "./MemberRoleModify";

type Props = {
  membershipDetails: TWorkspaceUser;
  isMembershipDetailsLoading?: boolean;
};

export const MemberRoleDetailsSection = ({
  membershipDetails,
  isMembershipDetailsLoading
}: Props) => {
  const { user } = useUser();
  const { currentWorkspace } = useWorkspace();
  const { popUp, handlePopUpOpen, handlePopUpToggle, handlePopUpClose } = usePopUp([
    "deleteRole",
    "modifyRole"
  ] as const);
  const { mutateAsync: updateUserWorkspaceRole } = useUpdateUserWorkspaceRole();

  const userId = user?.id;

  const handleRoleDelete = async () => {
    const { id } = popUp?.deleteRole?.data as TProjectRole;
    try {
      const updatedRole = membershipDetails?.roles?.filter((el) => el.id !== id);
      await updateUserWorkspaceRole({
        workspaceId: currentWorkspace?.id || "",
        roles: updatedRole,
        membershipId: membershipDetails.id
      });
      createNotification({ type: "success", text: "Successfully removed the role" });
      handlePopUpClose("deleteRole");
    } catch (err) {
      console.log(err);
      createNotification({ type: "error", text: "Failed to delete role" });
    }
  };

  return (
    <div className="w-full rounded-lg border border-mineshaft-600 bg-mineshaft-900 p-4">
      <div className="flex items-center justify-between border-b border-mineshaft-400 pb-4">
        <h3 className="text-lg font-semibold text-mineshaft-100">Project Roles</h3>
        {userId !== membershipDetails?.user?.id && membershipDetails?.status !== "invited" && (
          <ProjectPermissionCan
            I={ProjectPermissionActions.Edit}
            a={ProjectPermissionSub.Member}
            renderTooltip
            allowedLabel="Edit role"
          >
            {(isAllowed) => (
              <IconButton
                ariaLabel="copy icon"
                variant="plain"
                className="group relative"
                onClick={() => {
                  handlePopUpOpen("modifyRole");
                }}
                isDisabled={!isAllowed}
              >
                <FontAwesomeIcon icon={faPencil} />
              </IconButton>
            )}
          </ProjectPermissionCan>
        )}
      </div>
      <div className="py-4">
        <TableContainer>
          <Table>
            <THead>
              <Tr>
                <Th>Role</Th>
                <Th>Type</Th>
                <Th className="w-5" />
              </Tr>
            </THead>
            <TBody>
              {isMembershipDetailsLoading && (
                <TableSkeleton columns={3} innerKey="user-project-memberships" />
              )}
              {!isMembershipDetailsLoading &&
                membershipDetails?.roles?.map((roleDetails) => {
                  const isTemporary = roleDetails?.isTemporary;
                  const isExpired =
                    roleDetails.isTemporary &&
                    new Date() > new Date(roleDetails.temporaryAccessEndTime || "");

                  let text = "Permanent";
                  let toolTipText = "Non expiry access";
                  if (roleDetails.isTemporary) {
                    if (isExpired) {
                      text = "Access Expired";
                      toolTipText = "Timed Access Expired";
                    } else {
                      text = formatDistance(
                        new Date(roleDetails.temporaryAccessEndTime || ""),
                        new Date()
                      );
                      toolTipText = `Until ${format(
                        new Date(roleDetails.temporaryAccessEndTime || ""),
                        "yyyy-MM-dd hh:mm:ss aaa"
                      )}`;
                    }
                  }

                  return (
                    <Tr className="group h-10" key={`user-project-membership-${roleDetails?.id}`}>
                      <Td className="capitalize">
                        {roleDetails.role === "custom"
                          ? roleDetails.customRoleName
                          : formatProjectRoleName(roleDetails.role)}
                      </Td>
                      <Td>
                        <Tooltip asChild={false} content={toolTipText}>
                          <Tag
                            className={twMerge(
                              "capitalize",
                              isTemporary && "text-primary",
                              isExpired && "text-red-600"
                            )}
                          >
                            {text}
                          </Tag>
                        </Tooltip>
                      </Td>
                      <Td>
                        <div className="opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <ProjectPermissionCan
                            I={ProjectPermissionActions.Edit}
                            a={ProjectPermissionSub.Member}
                            renderTooltip
                            allowedLabel="Remove role"
                          >
                            {(isAllowed) => (
                              <IconButton
                                colorSchema="danger"
                                ariaLabel="copy icon"
                                variant="plain"
                                className="group relative"
                                isDisabled={!isAllowed}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePopUpOpen("deleteRole", {
                                    id: roleDetails?.id,
                                    slug: roleDetails?.customRoleName || roleDetails?.role
                                  });
                                }}
                              >
                                <FontAwesomeIcon icon={faTrash} />
                              </IconButton>
                            )}
                          </ProjectPermissionCan>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
            </TBody>
          </Table>
          {!isMembershipDetailsLoading && !membershipDetails?.roles?.length && (
            <EmptyState title="This user has not been assigned to any projects" icon={faFolder} />
          )}
        </TableContainer>
      </div>
      <DeleteActionModal
        isOpen={popUp.deleteRole.isOpen}
        deleteKey="remove"
        title={`Do you want to remove role ${(popUp?.deleteRole?.data as TProjectRole)?.slug}?`}
        onChange={(isOpen) => handlePopUpToggle("deleteRole", isOpen)}
        onDeleteApproved={() => handleRoleDelete()}
      />
      <Modal
        isOpen={popUp.modifyRole.isOpen}
        onOpenChange={(isOpen) => handlePopUpToggle("modifyRole", isOpen)}
      >
        <ModalContent title="Roles" subTitle="Select one of the pre-defined or custom roles.">
          <MemberRoleModify projectMember={membershipDetails} onOpenUpgradeModal={() => {}} />
        </ModalContent>
      </Modal>
    </div>
  );
};
