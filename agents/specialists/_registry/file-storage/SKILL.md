---
name: file-storage
summary: Object storage — S3, R2, Supabase Storage, Vercel Blob. Upload flows, presigned URLs, access control, lifecycle policies.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: test_suite
---

# file-storage specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md). Consults the [MCP-vs-CLI capability matrix](../../../../tools/mcp-cli-capability-matrix.md) ([ADR-0033](../../../../adr/0033-mcp-vs-cli-capability-matrix.md)) before choosing MCP vs CLI for storage-provider operations.

## Role + scope

Object-storage integration: bucket / container creation, upload flow (presigned URLs preferred over server-relay), CDN attachment, lifecycle policies, access control (public vs. signed-URL vs. private). Does NOT cover stateful filesystem mounts.

When to invoke: prompts about "upload", "file storage", "S3", "R2", "Cloudflare Images", "Supabase Storage", "Vercel Blob", "presigned URL".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `lib/storage/**`, related API routes.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FS-EX-01 | BE | Design | Plan implies server-relay upload (file uploaded TO the app, then to storage) for files > 5 MB | Architecture | Plan review | Upload flow design | `fs.server_relay_large_files` event | Plan | Recommendation | Recommend presigned-URL direct-upload pattern; surface the bandwidth / cost / lambda-timeout implications | Server-relay forces every byte through the app's compute. At even modest scale this exhausts lambda timeouts (10s/60s/15min depending on runtime) and triples bandwidth cost. Presigned URLs are the documented pattern (S3, R2, Supabase, Vercel Blob all support them) |
| FS-EX-02 | SE | Upload | Presigned URL has expired by the time the client uses it | Server time | Client upload | URL with expiry | `fs.presigned_expired` event | HTTP | HTTP error | Return a fresh URL; do NOT extend expiries beyond 15 minutes by default | Long expiries are a credential-leakage risk equivalent to giving out a long-lived API key. 15min is the AWS-recommended default |
| FS-EX-03 | BE | Access | User requests "make this object public" without considering the regulatory regime | Object metadata | API call | Object ID + access mode | `fs.public_access_request` event | String | ACL change | Confirm explicitly: "this will be world-readable; the object cannot be made private again retroactively for actors who already cached it." Wait for user yes | Public-by-accident is a common breach vector. The cache caveat matters because regret is impossible once a crawler has scraped the public URL |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes / HTTP status codes for any object-storage provider it invokes.

### AWS S3 / R2 (S3-compatible API) — `PutObject`, `CreatePresignedUrl`, `HeadObject`

- **Format**: XML or JSON depending on SDK; SDKs surface structured responses
- **Authoritative fields**: `ETag` (success on PUT), `VersionId` (when versioning enabled), `$response.statusCode`. SDK error name (`NoSuchBucket`, `AccessDenied`, `EntityTooLarge`, `SlowDown`)
- **Success criteria**: SDK returns; `ETag` present on PUT. For presigned URL generation: returned URL is well-formed AND has expected `X-Amz-Expires` query param
- **Failure criteria**: SDK throws; or `$response.statusCode` ≥ 400; or PUT response missing `ETag`
- **Vendor docs**: [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

### Cloudflare R2 native API (when not using S3-compat)

- **Format**: JSON via `wrangler r2` or Cloudflare API
- **Authoritative fields**: `success` (boolean), `result.id`, `errors[].code` + `errors[].message`
- **Success criteria**: `success === true` AND `errors` array empty
- **Failure criteria**: `success === false`; `errors` non-empty; HTTP 4xx/5xx
- **Vendor docs**: [Cloudflare R2 API](https://developers.cloudflare.com/api/operations/r2-list-buckets)

### Supabase Storage — `storage.from(bucket).upload()`, `.createSignedUrl()`

- **Format**: JSON (PostgREST + Storage API)
- **Authoritative fields**: `data.path` on upload success; `data.signedUrl` for signed URLs; `error.message` + `error.statusCode` on failure
- **Success criteria**: `error` is null AND `data` populated
- **Failure criteria**: `error` non-null. Common codes: 400 (Bad Request), 409 (Duplicate), 413 (Payload Too Large)
- **Vendor docs**: [Supabase Storage JS](https://supabase.com/docs/reference/javascript/storage-from-upload)

### Vercel Blob — `@vercel/blob`'s `put()`, `del()`, `head()`

- **Format**: JSON
- **Authoritative fields**: `url` (success on put), `pathname`, `contentType`, `contentDisposition`; on error: thrown `BlobError` with `.message`
- **Success criteria**: returned object contains `url`
- **Failure criteria**: throws `BlobError` / `BlobAccessError`
- **Vendor docs**: [Vercel Blob SDK](https://vercel.com/docs/storage/vercel-blob/using-blob-sdk)

### Presigned URL contract (cross-provider)

When generating presigned URLs, the returned URL string is itself the response. Discipline:
- Presence of an expiry query param (`X-Amz-Expires` for S3-compat, `signed_expires_in` for Supabase, `?download=<token>` for Vercel Blob) is asserted before returning to caller
- Expiry NEVER exceeds 15 minutes by default (FS-EX-02)
- Caller is informed of the expiry timestamp explicitly — never just "use this URL"

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Provider chosen + rationale
- Upload-flow design (presigned URL strongly preferred per FS-EX-01)
- ACL strategy + the explicit public-access acknowledgment if applicable (FS-EX-03)
- Lifecycle policies (delete-after-N-days, archive tier transitions)
- Failure-mode IDs (FS-EX-*) the implementation guards against

## Decline triggers

- **Stateful filesystem mounts** (EFS, FSx) → escalate; v0.4 covers object storage only.
- **PHI / regulated data without explicit compliance regime declared** → escalate to discovery flow (PR-N).

## Evidence basis

- **Primary:** Vendor docs (S3, R2, Supabase Storage, Vercel Blob). `[vendor][H]`
- **Corroborating:**
  - AWS S3 security best practices. `[institutional][H]`
  - OWASP "File Upload" cheat sheet. `[institutional][H]`
- **What would change this call:** new attack class against presigned URLs; vendor deprecates the pattern.

## Runtime counterpart

[`../../../../.claude/agents/file-storage.md`](../../../../.claude/agents/file-storage.md).
