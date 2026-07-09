---
date: 2026-06-15
agent: EAC (research-validator role)
severity: low
share: true
---

# Practitioner claim validation: source-tier discipline in action

## What happened

Validated six practitioner AI claims (Karpathy AISN talk, YouTube content, HBR) against peer-reviewed literature. The exercise surfaced systematic patterns in where practitioner claims overstate, understate, or accurately reflect the research record.

## Why it happened

Practitioner content (YouTube talks, blog posts, HBR editorial pieces) routinely cites no primary sources and presents domain findings at the level of a single anecdote or cherry-picked demo. When a downstream agent (e.g., a Loom specialist) treats these as load-bearing claims, it inherits the overfitting.

## What we did

For each claim: (1) identified the load-bearing assertion, (2) searched arXiv, NBER, ACM, and ICLR proceedings for peer-reviewed evidence, (3) fetched abstracts directly to verify author/venue/finding, (4) assigned verdict with confidence. Never fabricated a citation.

## What we'd do differently

1. **Search arXiv directly before WebSearch.** WebSearch returns many Tier-3 blog sources summarizing the same papers; fetching the abstract directly from arxiv.org is faster and cleaner.
2. **Watch for the "benchmark saturation" trap.** Practitioner claims about benchmark performance (SWE-bench, WebArena) go stale within months as SOTA advances. Always note the evaluation date, not just the paper date.
3. **Distinguish mechanism claim from performance claim.** Practitioners often conflate "X is theoretically sound" with "X achieves high performance." The literature may support the mechanism while the performance numbers are far lower than implied.
4. **Token exchange per-hop claim is mostly in standards documents and industry blogs (Tier 2/3), not peer-reviewed CS security papers.** RFC 8693 is authoritative but normative, not empirical. For security claims, OWASP guidance and IETF RFCs are the appropriate Tier-1 equivalent.
5. **Productivity J-curve has strong NBER/AEJ support but the "87% aspire / <5-10% at scale" statistic is from vendor surveys (McKinsey, IBM), not academic sources.** These should be tagged Tier 2, not Tier 1.

## Related

- Event log: 2026-06-15.jsonl (claim events for the six verdicts)
- No ADRs created (research output, not architectural decision)
