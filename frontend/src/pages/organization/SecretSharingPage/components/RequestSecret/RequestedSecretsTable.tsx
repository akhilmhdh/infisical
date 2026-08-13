import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
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
import { useGetSecretRequests } from "@app/hooks/api/secretSharing";
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
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const { isPending, data } = useGetSecretRequests({
    offset: (page - 1) * perPage,
    limit: perPage,
    sortBy,
    sortDir
  });

  const toggleSort = (column: string) => {
    if (column === sortBy) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortBy(column);
    setSortDir("desc");
  };

  const sortArrow = (column: string) => {
    if (column !== sortBy) return null;
    return sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
  };

  const hasSecrets = !isPending && data?.secrets && data.secrets.length > 0;

  return (
    <div>
      <p className="mb-3 text-sm text-mineshaft-400">{data?.totalCount ?? 0} requests</p>
      {(isPending || data) && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/4">
                <button type="button" className="flex items-center gap-1" onClick={() => toggleSort("name")}>
                  Name
                  {sortArrow("name")}
                </button>
              </TableHead>
              <TableHead>Access Type</TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort("createdAt")}
                >
                  Created
                  {sortArrow("createdAt")}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort("expiresAt")}
                >
                  Expires
                  {sortArrow("expiresAt")}
                </button>
              </TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead aria-label="button" className="w-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending &&
              Array.from({ length: 5 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <TableCell key={`skeleton-cell-${j}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {hasSecrets &&
              data.secrets.map((row) => (
                <RequestedSecretsRow key={row.id} row={row} handlePopUpOpen={handlePopUpOpen} />
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
