import { useState } from "react";
import { Trash2 } from "lucide-react";

import { createNotification } from "@app/components/notifications";

import {
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import { useDeleteSecretRequestsBulk, useGetSecretRequests } from "@app/hooks/api/secretSharing";
import { UsePopUpState } from "@app/hooks/usePopUp";

import { RequestedSecretsRow } from "./RequestedSecretsRow";

type Props = {
  handlePopUpOpen: (
    popUpName: keyof UsePopUpState<["deleteSecretRequestConfirmation", "revealSecretRequestValue"]>,
    data: unknown
  ) => void;
};

export const RequestedSecretsTable = ({ handlePopUpOpen }: Props) => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { isPending, data } = useGetSecretRequests({
    offset: (page - 1) * perPage,
    limit: perPage
  });
  const { mutateAsync: deleteBulk, isPending: isDeleting } = useDeleteSecretRequestsBulk();

  const hasSecrets = !isPending && data?.secrets && data.secrets.length > 0;
  const rows = data?.secrets ?? [];
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : rows.map((row) => row.id));
  };

  const handleDeleteSelected = async () => {
    const { deletedCount } = await deleteBulk({ secretRequestIds: selectedIds });
    createNotification({
      text: `Successfully deleted ${deletedCount} secret requests`,
      type: "success"
    });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-mineshaft-400">{selectedIds.length} selected</p>
        <Button
          variant="outline"
          size="xs"
          isPending={isDeleting}
          onClick={handleDeleteSelected}
        >
          <Trash2 />
          Delete {selectedIds.length} requests
        </Button>
      </div>
      {(isPending || hasSecrets) && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-5">
                <Checkbox
                  id="select-all-requests"
                  isChecked={allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-1/4">Name</TableHead>
              <TableHead>Access Type</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead aria-label="button" className="w-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending &&
              Array.from({ length: 5 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <TableCell key={`skeleton-cell-${j}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {hasSecrets &&
              data.secrets.map((row) => (
                <RequestedSecretsRow
                  key={row.id}
                  row={row}
                  handlePopUpOpen={handlePopUpOpen}
                  isSelected={selectedIds.includes(row.id)}
                  onToggleSelect={() => toggleRow(row.id)}
                />
              ))}
          </TableBody>
        </Table>
      )}
      {hasSecrets && data.totalCount >= perPage && data.totalCount !== undefined && (
        <Pagination
          count={data.totalCount}
          page={page}
          perPage={perPage}
          onChangePage={(newPage) => setPage(newPage)}
          onChangePerPage={(newPerPage) => setPerPage(newPerPage)}
        />
      )}
      {!isPending && !data?.secrets?.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No secrets requested yet</EmptyTitle>
            <EmptyDescription>Request a secret to get started</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};
