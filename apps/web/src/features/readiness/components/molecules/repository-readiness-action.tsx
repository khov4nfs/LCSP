"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthRepositoriesQuery } from "@/lib/api/auth-queries";
import { useStartRepositoryAnalysisMutation } from "@/lib/api/assessment-queries";

type RepositoryReadinessActionProps = {
  assessmentId: string;
};

export function RepositoryReadinessAction({
  assessmentId,
}: RepositoryReadinessActionProps) {
  const repositoriesQuery = useAuthRepositoriesQuery();
  const analysisMutation = useStartRepositoryAnalysisMutation(assessmentId);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");

  const availableRepositories = useMemo(
    () =>
      (repositoriesQuery.data ?? []).filter(
        (repository) =>
          repository.status === REPOSITORY_CONNECTION_STATUSES.active &&
          repository.revoked_at === null,
      ),
    [repositoriesQuery.data],
  );

  const selectedRepository = availableRepositories.find(
    (repository) => repository.id === selectedRepositoryId,
  );

  if (repositoriesQuery.isLoading) {
    return (
      <section className="rounded-lg border border-dashed p-4">
        <h2 className="text-sm font-medium">Repository cho assessment</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Đang tải các repository đã kết nối trong Settings...
        </p>
      </section>
    );
  }

  if (repositoriesQuery.isError || availableRepositories.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-4">
        <h2 className="text-sm font-medium">Repository cho assessment</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Chưa có repository khả dụng. Hãy kết nối repository trong Settings.
        </p>
        <Button
          className="mt-3"
          render={<Link href="/workspace/settings?section=repositories" />}
          variant="outline"
          nativeButton={false}
        >
          Mở cài đặt Repository
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-medium">Repository cho assessment</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Chọn repository đã kết nối trong Settings. LCSP sẽ pin commit mới nhất
        của branch mặc định cho assessment này và bắt đầu scan.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Select
            value={selectedRepositoryId}
            onValueChange={(value) => setSelectedRepositoryId(value ?? "")}
            disabled={analysisMutation.isPending}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue>
                {selectedRepository
                  ? `${selectedRepository.repository_full_name} · ${selectedRepository.default_branch}`
                  : "Chọn repository đã kết nối"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableRepositories.map((repository) => (
                <SelectItem key={repository.id} value={repository.id}>
                  {repository.repository_full_name} · {repository.default_branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          disabled={!selectedRepository || analysisMutation.isPending}
          onClick={() => {
            if (!selectedRepository) return;
            analysisMutation.mutate({
              connectionId: selectedRepository.id,
              branch: selectedRepository.default_branch,
            });
          }}
        >
          {analysisMutation.isPending
            ? "Đang tạo snapshot và bắt đầu scan..."
            : "Chọn repository"}
        </Button>
      </div>

      {analysisMutation.isError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Không thể bắt đầu phân tích repository</AlertTitle>
          <AlertDescription>
            Không thể tạo snapshot hoặc khởi chạy scan. Hãy kiểm tra quyền truy
            cập repository và thử lại.
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
