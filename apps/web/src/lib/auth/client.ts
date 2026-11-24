import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // Auth cookies belong to the host serving the UI. The public tracking and
  // provider callback origin can move independently.
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  plugins: [magicLinkClient()],
});
