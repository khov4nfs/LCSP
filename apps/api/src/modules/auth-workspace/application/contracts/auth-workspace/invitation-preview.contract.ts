import { ACCEPT_INVITATION_ERROR_CODES } from "@lcsp/contracts/auth";

export type InvitationPreviewRequest = {
  invitation_token?: string;
};

export type InvitationPreviewScope =
  | {
      type: "assessment";
      assessment: { id: string; name: string };
    }
  | {
      type: "organization";
      assessment: null;
    };

export type InvitationPreviewResponse = {
  organization: { id: string; name: string };
  scope: InvitationPreviewScope;
  allowed_actions: string[];
  expires_at: string;
  correlationId: string;
};

export type InvitationPreviewErrorCode =
  typeof ACCEPT_INVITATION_ERROR_CODES.invitationInvalid;
