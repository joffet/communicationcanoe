export const DEFAULT_MAIL_FROM =
  process.env.DEFAULT_MAIL_FROM ?? "info@communicationcanoe.com";

export type TenantMailFrom = {
  inboundEmailAddress: string;
};

export function resolveMailFrom(tenant?: TenantMailFrom | null): string {
  return tenant?.inboundEmailAddress ?? DEFAULT_MAIL_FROM;
}
