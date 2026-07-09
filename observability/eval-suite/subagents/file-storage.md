---
subagent: file-storage
canonical_prompt: |
  Add file upload for user avatars (max 2 MB each) and profile-video uploads
  (max 50 MB each). Storage is Supabase Storage. Avatars should be public-cached
  for performance; videos should be private (signed URL per view).
marker_behaviors:
  - Avatar (small): server-relay OR presigned, either is acceptable
  - Video (50 MB): MUST recommend presigned-URL direct-upload (server-relay would burn lambda timeouts)
  - Public avatar: confirms the cache-can't-be-revoked caveat
  - Private video: signed URL with expiry ≤ 15 minutes
  - Validates MIME types server-side (not just client)
  - Read SKILL.md `## Failure modes` before designing
---

# file-storage canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Video → presigned direct | yes | hedges | server-relay |
| Public confirms cache caveat | yes | mentions | omits |
| Private signed URL ≤ 15min | yes | weak limit | no limit |
| MIME validated server-side | yes | client only | none |

**Pass:** ≥ 3/4.
