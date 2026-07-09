# Critic checklist — Compliance

> Used by the Critic subagent when reviewing discovery artifacts. Per [ADR-0026](../../../adr/0026-discovery-gate.md).

## Regime identification

- [ ] Compliance regime(s) declared in `discovery/quick-scan.md` (none / GDPR / HIPAA / SOC2 / PCI / FERPA / CCPA / other)
- [ ] If "none", document what data classifications justify that (no PII, no payment data, no PHI, no student records)

## Data inventory

- [ ] PII categories captured (name, email, address, IP, device IDs, identifiers)
- [ ] PHI categories captured (if HIPAA in scope)
- [ ] Cardholder data flows mapped (if PCI in scope; preferably none — provider tokenization)
- [ ] Student educational records mapped (if FERPA in scope)
- [ ] Data residency requirements declared

## Lawful basis (GDPR-specific)

- [ ] Lawful basis identified per processing activity (consent / contract / legal obligation / vital interests / public task / legitimate interests)
- [ ] DPIA conducted for high-risk processing
- [ ] Records of processing activities maintained (Art. 30)

## User rights

- [ ] Access (DSAR) flow designed
- [ ] Erasure (right to be forgotten) flow designed; data retention limits documented
- [ ] Portability (data export) flow designed
- [ ] Rectification flow designed
- [ ] Consent withdrawal flow (where consent is the basis)
- [ ] Do-Not-Sell / Do-Not-Share flow (CCPA)

## Vendor + processor management

- [ ] DPA (Data Processing Agreement) with each processor handling personal data
- [ ] BAA with each vendor touching PHI (HIPAA)
- [ ] Sub-processor list maintained + disclosed

## Logging + audit

- [ ] Access to PII / PHI logged
- [ ] Audit log retention meets regulatory minimum (HIPAA: 6 years; PCI: 1 year; varies)
- [ ] Log access itself restricted + audited

## Breach notification

- [ ] Incident response plan in place
- [ ] Notification timelines documented (GDPR: 72h; state laws vary)
- [ ] Contact list maintained for regulator + counsel

## References

- GDPR (Regulation 2016/679) — `[primary][H]`
- HIPAA Security Rule (45 CFR §164.302-318) — `[primary][H]`
- PCI-DSS v4.0.1 — `[institutional][H]`
- AICPA SOC 2 Trust Services Criteria — `[institutional][H]`
- FERPA (20 USC §1232g) — `[primary][H]`
- CCPA / CPRA — `[primary][H]`
