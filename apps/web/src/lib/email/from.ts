export const DEFAULT_MAIL_FROM =
  process.env.DEFAULT_MAIL_FROM ?? "info@communicationcanoe.com";

export type TenantMailFrom = {
  inbound_email_address: string;
};

export function resolveMailFrom(tenant?: TenantMailFrom | null): string {
  return tenant?.inbound_email_address ?? DEFAULT_MAIL_FROM;
}
