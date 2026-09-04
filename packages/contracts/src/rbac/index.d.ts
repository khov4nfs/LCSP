export declare const RBAC_DECISIONS: {
    readonly allow: "ALLOW";
    readonly deny: "DENY";
};
export type RbacDecision = (typeof RBAC_DECISIONS)[keyof typeof RBAC_DECISIONS];
export declare const RBAC_REASON_CODES: {
    readonly authorized: "AUTHORIZED";
    readonly denied: "RBAC_DENIED";
    readonly loadError: "LOAD_ERROR";
    readonly metadataMissing: "RBAC_METADATA_MISSING";
    readonly mfaRequired: "MFA_REQUIRED";
    readonly sessionInvalid: "SESSION_INVALID";
};
export type RbacReasonCode = (typeof RBAC_REASON_CODES)[keyof typeof RBAC_REASON_CODES];
export type RbacContextDenialReason = typeof RBAC_REASON_CODES.sessionInvalid | typeof RBAC_REASON_CODES.mfaRequired | typeof RBAC_REASON_CODES.loadError;
//# sourceMappingURL=index.d.ts.map