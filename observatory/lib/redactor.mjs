import { redactSecrets } from "../../scripts/lib/secret-patterns.mjs";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const WIN_USER_PATH_RE = /[A-Z]:\\Users\\[^\\"\s]+/gi;
const POSIX_HOME_RE = /\/(?:home|Users)\/[^/"\s]+/g;

export function redact(value) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

function redactString(s) {
  let r = redactSecrets(s);
  r = r.replace(EMAIL_RE, "<redacted:email>");
  r = r.replace(IPV4_RE, (match) => {
    if (match === "127.0.0.1" || match === "0.0.0.0" || match.startsWith("192.168.")) return match;
    return "<redacted:ip>";
  });
  r = r.replace(WIN_USER_PATH_RE, (match) => {
    const parts = match.split("\\");
    return parts.slice(0, 3).join("\\") + "\\<redacted>";
  });
  r = r.replace(POSIX_HOME_RE, (match) => {
    const parts = match.split("/");
    return parts.slice(0, 3).join("/") + "/<redacted>";
  });
  return r;
}
