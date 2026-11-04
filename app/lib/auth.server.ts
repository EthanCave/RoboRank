import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "react-router";

const SESSION_COOKIE_NAME = "roborank_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AppUser = {
  id: string;
  email: string;
  name: string;
  teamCode: string;
  createdAt: string;
};

type SessionPayload = {
  teamCode: string;
  issuedAt: string;
};

const isProduction = process.env.NODE_ENV === "production";

// Development falls back to throwaway defaults; production refuses to run with them.
function requiredSetting(name: string, devDefault: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production.`);
  return devDefault;
}

function sessionSecret() {
  return requiredSetting("SESSION_SECRET", "local-session-secret-change-me");
}

function loginPassword() {
  return requiredSetting("ROBORANK_LOGIN_PASSWORD", "roborank");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function loginLabel() {
  return process.env.ROBORANK_LOGIN_LABEL ?? "Team Access";
}

function defaultTeamCode() {
  return normalizeTeamCode(process.env.ROBORANK_DEFAULT_TEAM?.trim() || "355V");
}

function staticUserBase() {
  return {
    id: "team-admin",
    email: "team@roborank.local",
    name: loginLabel(),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};

  return header
    .split(";")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, piece) => {
      const index = piece.indexOf("=");
      if (index <= 0) return acc;
      const key = piece.slice(0, index);
      const value = piece.slice(index + 1);
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function normalizeTeamCode(teamCode: string) {
  return teamCode.trim().toUpperCase();
}

function signPayload(payloadText: string) {
  return createHmac("sha256", sessionSecret()).update(payloadText).digest("hex");
}

function parseSessionToken(token: string): SessionPayload | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const separatorIndex = decoded.lastIndexOf(".");
    if (separatorIndex <= 0) return null;

    const payloadText = decoded.slice(0, separatorIndex);
    const signature = decoded.slice(separatorIndex + 1);
    if (!payloadText || !signature) return null;

    const expected = signPayload(payloadText);
    if (!safeEqual(signature, expected)) return null;

    const parsed = JSON.parse(payloadText) as SessionPayload;
    const teamCode = normalizeTeamCode(parsed.teamCode || "");
    if (!teamCode) return null;

    return {
      teamCode,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function createSessionToken(payload: SessionPayload) {
  const payloadText = JSON.stringify(payload);
  const signature = signPayload(payloadText);
  return Buffer.from(`${payloadText}.${signature}`, "utf8").toString("base64url");
}

function buildCookie(token: string, maxAgeSeconds: number) {
  // COOKIE_SECURE=false allows plain-HTTP deployments (e.g. a LAN box at an event).
  const secure = isProduction && process.env.COOKIE_SECURE !== "false" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function userFromTeamCode(teamCode: string): AppUser {
  return {
    ...staticUserBase(),
    teamCode: normalizeTeamCode(teamCode) || defaultTeamCode(),
  };
}

export function verifyLoginPassword(password: string) {
  return safeEqual(password, loginPassword());
}

export function createSessionCookie(teamCode: string) {
  const payload: SessionPayload = {
    teamCode: normalizeTeamCode(teamCode) || defaultTeamCode(),
    issuedAt: new Date().toISOString(),
  };

  return buildCookie(createSessionToken(payload), SESSION_MAX_AGE_SECONDS);
}

export function clearSessionCookie() {
  return buildCookie("", 0);
}

export async function getUserFromRequest(request: Request): Promise<AppUser | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const payload = parseSessionToken(token);
  if (!payload) return null;

  return userFromTeamCode(payload.teamCode);
}

export async function requireUser(request: Request): Promise<AppUser> {
  const user = await getUserFromRequest(request);
  if (!user) throw redirect("/login");
  return user;
}

export function getDefaultTeamCode() {
  return defaultTeamCode();
}
