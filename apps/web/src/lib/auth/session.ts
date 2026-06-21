import { headers } from "next/headers";
import { auth } from "./server";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

export type AppSession = NonNullable<Awaited<ReturnType<typeof requireSession>>>;
