"use client";
import { useMutation } from "@tanstack/react-query";
import type { AcceptAccountInvitationInput } from "@lcsp/contracts/auth";
import { ADMIN_ACCOUNT_ERRORS } from "@lcsp/contracts/auth";
import { apiRequest } from "./api-request";
export function useAcceptAccountInvitation() {
  return useMutation({
    mutationFn: async (input: AcceptAccountInvitationInput) => {
      const result = await apiRequest("/api/auth/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!result.ok)
        throw new Error(
          result.problemCode ?? ADMIN_ACCOUNT_ERRORS.invalidInvitation,
        );
      return result.payload;
    },
    retry: false,
  });
}
