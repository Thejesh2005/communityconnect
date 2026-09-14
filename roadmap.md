# CivicLens roadmap

## Done — citizen reporting flow
- [x] Design system (civic paper / signal terracotta / status colours)
- [x] Accounts: email + password and Google sign-in, protected area
- [x] Camera-first capture with on-device quality pre-check (blur, darkness, framing)
- [x] Photo compression + SHA-256 hash for idempotent submissions
- [x] GPS auto-capture with draggable map pin confirmation (Leaflet + OpenStreetMap)
- [x] Private photo storage, per-citizen access only
- [x] Report created instantly, analysis runs after; "analyzing…" status polls in
- [x] AI pipeline: vision detection → computed severity (0-100) → department routing
- [x] Confidence-gated human-review queue
- [x] Duplicate merging by ~33m location cell + category ("confirmed by N citizens")
- [x] Audit trail of every status change

## Next
- [ ] Public status map with pins coloured by reported / in-progress / resolved
- [ ] Department crew view: update status, upload resolution photo
- [ ] Citizen feedback: confirm fix or reopen
- [ ] Offline queue + installable app (PWA) for poor connectivity
- [ ] Internal metrics dashboard: confidence over time, share auto-queued for review, routing accuracy

## Municipal staff portal (done)
- [x] Separate staff sign-in at /staff, admin-approved department access
- [x] Department queue + in-app notifications for newly routed reports
- [x] Status updates (acknowledged / in progress / resolved) with note + resolution photo, written to the audit trail
- [x] Citizens see staff updates and the resolution photo on their report
- [ ] Email alerts to department inboxes — blocked: needs a verified email sending domain
