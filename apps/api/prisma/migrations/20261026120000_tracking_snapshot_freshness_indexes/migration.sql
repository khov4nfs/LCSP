CREATE INDEX "RepositorySnapshot_repo_ref_status_created_idx"
  ON "RepositorySnapshot" ("repositoryFullName", "ref", "status", "createdAt");

CREATE INDEX "RepositorySnapshot_repo_branch_status_created_idx"
  ON "RepositorySnapshot" ("repositoryFullName", "branch", "status", "createdAt");
