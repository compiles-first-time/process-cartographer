# Critic checklist — Security

> Used by the Critic subagent when reviewing `discovery/requirements.md` and `discovery/risk-register.md`. Per [ADR-0026](../../../adr/0026-discovery-gate.md).
>
> The Critic checks each item below against the requirements / risk register and flags gaps. The user (or the relevant specialist) decides whether to address each gap or accept the risk with justification.

## Authentication & session

- [ ] Authentication mechanism declared (password / OAuth / passkey / SSO)
- [ ] Password hashing algorithm specified (argon2id preferred per OWASP ASVS v4.0.3 §2.4)
- [ ] MFA / 2FA available for at least admin accounts
- [ ] Session cookie flags declared (HttpOnly, Secure, SameSite)
- [ ] Session timeout + revocation flow defined
- [ ] Account recovery flow does NOT depend solely on SMS (NIST AAL2+)

## Authorization

- [ ] Authorization model declared (RBAC / ABAC / per-resource)
- [ ] Privilege escalation paths enumerated and constrained
- [ ] Default-deny policy on new resources

## Input handling

- [ ] Input validation strategy declared (allowlist > denylist)
- [ ] Output encoding strategy for HTML / SQL / shell / LDAP
- [ ] File upload constraints (MIME, size, scan) declared

## Secrets & credentials

- [ ] Secrets storage declared (env / managed / OS keyring) — never in repo
- [ ] Rotation procedure documented
- [ ] LR-03 compliance: no secrets in chat input or tool args

## Transport security

- [ ] TLS-only (HTTPS) enforced
- [ ] HSTS configured
- [ ] Cookie + CORS scoping documented

## Logging & monitoring

- [ ] Authentication events logged (success + failure)
- [ ] Authorization decisions logged
- [ ] PII scrubbing on error-tracking SDK (per `error-tracking` specialist)

## Threat model coverage

- [ ] Top OWASP risks for this project type identified
- [ ] At least one SE row and one BE row in `risk-register.md` per OWASP category

## References

- OWASP ASVS v4.0.3 — `[institutional][H]`
- OWASP Top 10 (current edition) — `[institutional][H]`
- NIST SP 800-63B — `[institutional][H]`
