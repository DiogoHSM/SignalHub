# Audit release evidence — 2026-09-03

Status: preparation only. No push, merge, app deployment, SDK publication or Linear status transition has occurred.

## Authority and source

User authorized push/merge and VPS deployment after checks/reviews, plus an SDK release when impacted. SDK 0.2.1 is planned. Release plan: `docs/superpowers/plans/2026-09-03-audit-release.md`.

Production API remains at `24b065b2a4cfa99365cbec8565e6dcd9f0674196`. Local main/origin main remain `a266f0e375c3b491a778d588cfae2c958fb2fab0`. Reviewed source is not yet final; dependency work is active.

## Coolify access and runtime inventory

User supplied a signed-in Chrome session. Read-only UI and supported host terminal access succeeded. No browser tokens, credentials or secret values were extracted.

The Coolify host identifies itself as `services`, with 8 CPUs, 16 GiB memory (12 GiB available), and 27% disk used (143 GiB free). Load sampled 7.40/7.44/6.90; short CPU samples showed 80% and 37% idle, with no swap or I/O wait. This is bursty CPU demand; do not extrapolate an earlier separate SSH host measurement to this container host. Build applications sequentially and remeasure before rollout.

Sigmon-only `docker stats --no-stream` measured API 0.62% CPU / 260.2 MiB, queue worker 0.80% / 189.4 MiB, scheduler 0.72% / 192.5 MiB. No production builds/test loads were started. Remote Docker reports 34 images (28 active), 16.59 GB total and 2.125 GB reclaimable; no image was removed and all volumes were preserved.

All three application containers run as `sigmon`, with no explicit Docker CPU/memory limit and `Mounts=[]`:

| Role | Coolify app ID | Preserved current image |
| --- | --- | --- |
| API | aknap6ycvhxpgagj93uhrypf | sha256:4f6c216aba334bef85b5c64f8cbf12d0d48591c96a0247b01ae993da70f2c7d8 |
| Queue worker | sn4xfev7jxne6mv7ky98hsne | sha256:34897a1b9a7c38d6dd6819d313b01457918a8fdf7d162d395dd344f24ddf812c |
| Scheduler | gjs8txnnar08dkv172vqvcmg | sha256:99e40ca914426832abb8332ea0926fc4151d61949b1f025081fa47f04dbfdb01 |

API environment key-name inspection confirms `DATA_ENCRYPTION_KEY` and `TRUSTED_PROXY_CIDRS` are absent; no secret value was read. User was asked to provision and escrow the same data-encryption key across all services. Actual runtime source-map and backup paths are the documented `/var/lib/sigmon/source-maps` and `/var/lib/sigmon/backups`.

Effective API Docker inspection confirms `CAP_SYS_ADMIN`, FUSE device access and `apparmor:unconfined`; the UI also supplies a shell entrypoint override. Tracked as [PER-520](https://linear.app/data4ward/issue/PER-520/deployment-audit-remove-unnecessary-privileged-api-container-options), created/read back in Personal / Sigmon under PER-502. This is an operational observation, not a sealed code-scan finding. No runtime options changed yet.

## Existing backup preservation

API and queue-worker operational directories contain no files. Scheduler directories contain 12 files, approximately 29.4 MiB of backups; source-map directory is empty. This confirms a live deployment gap in the existing PER-509/PER-510 storage scope.

Created a new, previously absent host directory `/var/lib/sigmon-audit-preserve-20260903` with mode 0700 and copied the scheduler's entire backup directory to `scheduler-backups` beneath it. Docker reported 30.8 MB copied. Original container files remain untouched. This preservation copy is not the fresh pre-migration backup and is not key escrow. It must be retained through release and cleanup.

`sha256sum --check -- *.sha256` verified all six dumps dated August 28 through September 2, 2026. Directory readback is `700 root:root`. No volume, image, container, branch or worktree has been deleted.

## Read-only database inventory

Bounded aggregate queries through the existing Postgres container report latest migration `0047_read_tokens.sql`, zero warehouse destinations, zero notification channels, and 10 API keys. No credentials, key hashes, destination values or customer rows were selected. Migrations 0048–0051 remain unapplied. Existing integration-delivery verification is not applicable to an empty integration inventory; schema/conversion confirmation and isolated integration tests remain required.

Asked the user whether external applications use `identifyUser`/`identifyTenant`, because existing keys become browser-scoped and such server clients require new separately scoped credentials. No key was created, relabeled, revoked or revealed.

## Outstanding release gates

- Remaining dependency plan tasks and final cumulative reviews/tests.
- SDK version metadata and package verification.
- Secure encryption-key provisioning/escrow and runtime validation.
- Durable source-map mounts shared across roles and scheduler backup mount.
- Default unprivileged runtime validation and PER-520 live change.
- Fresh verified pre-migration backup, migration job and capability/client inventory.
- GitHub merge/CI, coordinated production migration/deploy, live functional checks.
- OIDC SDK publication and published-consumer verification.
- Exact safe cleanup after successful release.
