import { SignJWT, jwtVerify } from "jose";

/**
 * Session tokens: HS256 JWT in an httpOnly cookie. This module has no
 * Node-only imports, so it can be used from proxy.ts as well as route handlers.
 */
export const SESSION_COOKIE = "drtrader_session";

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string, hours: number) {
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject("owner")
    .setExpirationTime(`${hours}h`)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}
