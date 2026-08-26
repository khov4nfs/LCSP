-- AddForeignKey
ALTER TABLE "AuthMfaOtpUsed" ADD CONSTRAINT "AuthMfaOtpUsed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthOAuthState" ADD CONSTRAINT "AuthOAuthState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthOAuthState" ADD CONSTRAINT "AuthOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WizardProfile" ADD CONSTRAINT "WizardProfile_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WizardProfile" ADD CONSTRAINT "WizardProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WizardProfile" ADD CONSTRAINT "WizardProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessExport" ADD CONSTRAINT "ReadinessExport_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessExport" ADD CONSTRAINT "ReadinessExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessExport" ADD CONSTRAINT "ReadinessExport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExportRequest" ADD CONSTRAINT "AuditExportRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExportRequest" ADD CONSTRAINT "AuditExportRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScanJob" ADD CONSTRAINT "RepositoryScanJob_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScanJob" ADD CONSTRAINT "RepositoryScanJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScanJob" ADD CONSTRAINT "RepositoryScanJob_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_inputEvidenceReportId_fkey" FOREIGN KEY ("inputEvidenceReportId") REFERENCES "TechnicalEvidenceReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_outputEvidenceReportId_fkey" FOREIGN KEY ("outputEvidenceReportId") REFERENCES "TechnicalEvidenceReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "RepositoryScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetedReanalysisRequest" ADD CONSTRAINT "TargetedReanalysisRequest_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalEvidenceReport" ADD CONSTRAINT "TechnicalEvidenceReport_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalEvidenceReport" ADD CONSTRAINT "TechnicalEvidenceReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalEvidenceReport" ADD CONSTRAINT "TechnicalEvidenceReport_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "RepositoryScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalEvidenceReport" ADD CONSTRAINT "TechnicalEvidenceReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalProfile" ADD CONSTRAINT "TechnicalProfile_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalProfile" ADD CONSTRAINT "TechnicalProfile_evidenceReportId_fkey" FOREIGN KEY ("evidenceReportId") REFERENCES "TechnicalEvidenceReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalProfile" ADD CONSTRAINT "TechnicalProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageFlow" ADD CONSTRAINT "AIUsageFlow_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageFlow" ADD CONSTRAINT "AIUsageFlow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageFlow" ADD CONSTRAINT "AIUsageFlow_technicalProfileId_fkey" FOREIGN KEY ("technicalProfileId") REFERENCES "TechnicalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictRecord" ADD CONSTRAINT "ConflictRecord_aiUsageFlowId_fkey" FOREIGN KEY ("aiUsageFlowId") REFERENCES "AIUsageFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictRecord" ADD CONSTRAINT "ConflictRecord_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictRecord" ADD CONSTRAINT "ConflictRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictRecord" ADD CONSTRAINT "ConflictRecord_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRuntimeEvent" ADD CONSTRAINT "AssessmentRuntimeEvent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRuntimeEvent" ADD CONSTRAINT "AssessmentRuntimeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_aiUsageFlowId_fkey" FOREIGN KEY ("aiUsageFlowId") REFERENCES "AIUsageFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AuthUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_technicalEvidenceReportId_fkey" FOREIGN KEY ("technicalEvidenceReportId") REFERENCES "TechnicalEvidenceReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedProfile" ADD CONSTRAINT "VerifiedProfile_wizardProfileId_fkey" FOREIGN KEY ("wizardProfileId") REFERENCES "WizardProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_legalRuleMatchId_fkey" FOREIGN KEY ("legalRuleMatchId") REFERENCES "LegalRuleMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_verifiedProfileId_fkey" FOREIGN KEY ("verifiedProfileId") REFERENCES "VerifiedProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationReviewRequest" ADD CONSTRAINT "ClassificationReviewRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationReviewRequest" ADD CONSTRAINT "ClassificationReviewRequest_legalRuleMatchId_fkey" FOREIGN KEY ("legalRuleMatchId") REFERENCES "LegalRuleMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationReviewRequest" ADD CONSTRAINT "ClassificationReviewRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationReviewRequest" ADD CONSTRAINT "ClassificationReviewRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_classificationResultId_fkey" FOREIGN KEY ("classificationResultId") REFERENCES "ClassificationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppInstallState" ADD CONSTRAINT "GitHubAppInstallState_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppInstallState" ADD CONSTRAINT "GitHubAppInstallState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubAppInstallState" ADD CONSTRAINT "GitHubAppInstallState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRule" ADD CONSTRAINT "LegalRule_legalRuleCatalogVersionId_fkey" FOREIGN KEY ("legalRuleCatalogVersionId") REFERENCES "LegalRuleCatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleApprovalRecord" ADD CONSTRAINT "RuleApprovalRecord_legalRuleCatalogVersionId_fkey" FOREIGN KEY ("legalRuleCatalogVersionId") REFERENCES "LegalRuleCatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleMatch" ADD CONSTRAINT "LegalRuleMatch_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleMatch" ADD CONSTRAINT "LegalRuleMatch_legalRuleCatalogVersionId_fkey" FOREIGN KEY ("legalRuleCatalogVersionId") REFERENCES "LegalRuleCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleMatch" ADD CONSTRAINT "LegalRuleMatch_corpusVersionId_fkey" FOREIGN KEY ("corpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleMatch" ADD CONSTRAINT "LegalRuleMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AuthOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleMatch" ADD CONSTRAINT "LegalRuleMatch_verifiedProfileId_fkey" FOREIGN KEY ("verifiedProfileId") REFERENCES "VerifiedProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
