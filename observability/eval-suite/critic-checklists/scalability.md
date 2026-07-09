# Critic checklist — Scalability + Performance

> Used by the Critic subagent when reviewing discovery artifacts. Per [ADR-0026](../../../adr/0026-discovery-gate.md).

## Targets

- [ ] Concurrent user target declared (10 / 100 / 1k / 10k)
- [ ] p95 latency target declared (with measurement boundary — server-side / TTFB / TTI)
- [ ] Throughput target declared (req/sec sustained)
- [ ] Cost ceiling declared

## Architecture for scale

- [ ] Stateless request handlers where feasible
- [ ] Database connection pooling configured
- [ ] N+1 query patterns audited (Prisma, ORM)
- [ ] Caching strategy declared (CDN / app-level / DB-level)
- [ ] Background job offloading for > 10s work (per `queues` specialist)

## Database

- [ ] Indexes on filter / sort columns identified
- [ ] Query patterns include EXPLAIN review for hot paths
- [ ] Slow-query alerting in place (per `monitoring` specialist)
- [ ] Connection limits known (DB plan capacity)

## Storage + bandwidth

- [ ] Large file uploads via presigned URLs (per `file-storage` specialist)
- [ ] Object storage lifecycle policies for transient data
- [ ] CDN for static assets

## Burst handling

- [ ] Rate limits per route declared
- [ ] Backpressure strategy (queue + 429s vs. degrade gracefully)
- [ ] Circuit breakers on third-party dependencies

## Capacity testing

- [ ] Load-test plan exists (k6, Artillery, Vegeta)
- [ ] Realistic data volume in staging
- [ ] Cold-start latency measured (serverless)

## SLO + SLI

- [ ] SLO defined (per Google SRE workbook)
- [ ] SLI metrics implemented + collected
- [ ] Error budget policy declared

## References

- Google SRE Workbook — `[institutional][H]`
- Brendan Gregg, "Systems Performance" — `[primary][H]`
- USE method + RED method — `[institutional][H]`
