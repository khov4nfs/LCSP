export type SensitiveRouteCheckDto = {
  is_sensitive: boolean;
  route_id: string | null;
  reauth_required: boolean;
  verified_at: string | null;
  expires_at: string | null;
};
