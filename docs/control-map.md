# Control map

<!-- Generated from control-map.yml by scripts/control-map-doc.js. Edit the YAML, then run `npm run control-map-doc`. -->

How each item in Information Security's review standard is met by a Choreo app. Source: AI/Vibe-Coded Application Review & Approval Standard, Platform Engineering's numbered copy of 2026-10-12: https://github.com/DavidsonCollege/platform-engineering/blob/main/docs/systems/infosec-ai-app-review-standard.md.

140 items: 114 depend on the app and appear in every assessor report; 26 are met by the same pipeline step for every app and are recorded here only.

| Met by | What it means | Pages | Container |
|---|---|---|---|
| platform | The hosting module or the shared layer provides it | 5 | 32 |
| check | A blocking CI check confirms it | 31 | 31 |
| flag | The assessor judges it, with evidence | 10 | 32 |
| attested | The builder confirms it at the ready call | 12 | 18 |
| n/a | Doesn't apply to the tier | 56 | 1 |

## Where a Choreo decision takes precedence or conflicts

- **4.7** WAF and Davidson SSO in front of internet-facing apps: Decision of 2026-10-12 on #85 takes precedence: Public and Internal apps have no WAF; every Restricted and Confidential app sits behind it, including one reachable only from campus and VPN.
- **4.9** Phishing-resistant MFA above Public data: Decision of 2026-10-12 on #85 takes precedence: Choreo apps use Davidson SSO with Duo; the phishing-resistant requirement doesn't apply, and PE is raising it with InfoSec.
- **5.4.1** WAF and SSO actually in the traffic path; origin not directly reachable: As 4.7.
- **5.9.3** Production deploys use OIDC to a protected environment with a required reviewer: Decision 25 (2026-10-12) has builders merge their own pull requests once the checks pass, and deploys run from `main` with no required reviewer. This item's required reviewer conflicts with it; to raise with InfoSec.
- **5.10.1** WCAG 2.1 Level AA: Decision 36 (2026-10-12) sets WCAG 2.0 AA, which Davidson is bound to; this item says 2.1 AA. To reconcile with InfoSec.

## Not fully met yet

- **5.8.4** Production dependencies pinned exactly: The checks don't yet fail a floating specifier, such as `^1.2.0`, in package.json.
- **5.8.7** SBOM generated at each release and stored: Nothing generates an SBOM yet.

## 1. App registration (passport fields)

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **1.1** Application name and purpose | check | check | The passport's `app` and `purpose`, required by the passport check. |
| **1.2** Builder name and department | check | check | The passport's `app_owners` and `department`, required by the passport check. |
| **1.3** Assigned business owner | check | check | The passport's `business_owner`, required by the passport check, which also fails when the business owner is one of the app owners. |
| **1.4** Assigned T&I reviewer | process | process | PE records the reviewer in the app's `spec.yaml` at the ready call; it's PE's record, not the owner's claim (pipeline.md decision 4). |
| **1.5** Tools used to build it | check | check | The passport's `built_with`, which the plugin fills in, required by the passport check. |
| **1.6** Where it runs | check | check | The passport's `profile.tier`, required by the passport check; the tier check confirms the code matches it. |
| **1.7** Internet-facing or public audience | check | check | The passport's `profile.audience` and `audience_scope`, required by the passport check. |
| **1.8** WAF and sign-in waiver, if granted | process | process | Recorded by PE in `spec.yaml` with its reference, approver and expiry, outside the passport (decided on #38). |
| **1.9** Data classifications touched | check | check | The passport's `profile.data_classification`, one of the four classes, required by the passport check; a Pages site may only hold Public data. |
| **1.10** Custody plan | check | check | The passport's `custody`, required by the passport check. |
| **1.11** Audience and brand designation | check | check | The passport's `audience_scope` and `brand`, required by the passport check. |
| **1.12** Indexability, no by default | check | check | The passport's `indexable`; the indexing check confirms the built site matches it. |
| **1.13** License | check | check | The passport's `license`; the license check confirms a LICENSE file matches it. |
| **1.14** Review and recertification date | check | check | The passport's `review`, required by the passport check; the renewal sweep acts on it. |

## 3. Data understanding and classification

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **3.1** What data the app reads, stores or transmits | flag | flag | The passport names the classification and, in `retention`, each data type. The assessor compares that with what the code actually handles and flags anything the passport doesn't cover. |
| **3.2** Each data type classified | flag | flag | As 3.1: the passport's classification, checked by the assessor against the code. |
| **3.3** US-based storage and processing, pinned regions | n/a | platform | The hosting module deploys every Azure resource to a pinned US region. A Pages site holds Public data only. |
| **3.4** Storage platform approved for the classification | n/a | platform | The hosting module's storage and key vault are RBAC-only and, for Restricted and Confidential apps, firewalled to the AIToolsRestricted subnet in a US region. A Pages site has no storage. |
| **3.5** Confidential or Restricted data leaving Davidson infrastructure | n/a | flag | The assessor compares the passport's `integrations`, each with its own data classification, against the app's classification and the code's outbound calls. |
| **3.6** External LLM with live data: provider retention and training terms | attested | attested | The passport's `llm` says whether live data enters prompts; the builder confirms the provider's no-training and retention terms at the ready call. |
| **3.7** Vendor review for any external service receiving Davidson data | flag | flag | The assessor checks each integration in the passport against the approved vendor list; discovery asks first (#86). |
| **3.8** Data Processing Agreement where required | attested | attested | A ready-call attestation: a data processing agreement where a vendor needs one (#89). |
| **3.9** Retention defined per data type, with automated deletion | n/a | platform | The passport's `retention`, required when the app writes data; the hosting module builds storage lifecycle rules from it (Part 5). |
| **3.10** Applicable regulations identified | check | check | The passport's `regulations`, required by the passport check; any match routes discovery to a human with InfoSec and Legal (#86). |

## 4. Tier-1 security gate

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **4.1** No secrets or API keys in frontend code or repositories | check | check | The secrets check scans the full git history with gitleaks; a finding blocks until rotated and removed from history with PE (decision 35). |
| **4.2** Record-level security on every table | n/a | flag | Security rubric: record-level security. |
| **4.3** Authorization enforced server-side | n/a | flag | Security rubric: client-side-only authorization. `AGENTS.md` rule 8 tells the coding agent to check authorization on the server. |
| **4.4** No admin tooling or debug endpoints exposed publicly | n/a | flag | Security rubric: exposed admin and debug endpoints. |
| **4.5** AES-256 encryption at rest for Confidential and Restricted data | n/a | platform | Azure Storage and Key Vault encrypt at rest with AES-256 by default. |
| **4.6** TLS 1.2 or later on all connections | platform | platform | Container Apps and GitHub Pages serve HTTPS only, with TLS 1.2 minimum set by the hosting module; the code check fails any plain `http://` call. |
| **4.7** WAF and Davidson SSO in front of internet-facing apps | n/a | platform | Platform sign-in through Davidson SSO on every container app; Restricted and Confidential apps sit behind the WAF, Public and Internal apps don't. A Pages site is Public with no sign-in. **Precedence:** Decision of 2026-10-12 on #85 takes precedence: Public and Internal apps have no WAF; every Restricted and Confidential app sits behind it, including one reachable only from campus and VPN. |
| **4.8** Davidson SSO, no homegrown login | n/a | platform | Container Apps' built-in authentication with Davidson's Entra tenant, enforced by the platform rather than app code; `AGENTS.md` rule 8 forbids homegrown login. |
| **4.9** Phishing-resistant MFA above Public data | n/a | platform | Davidson SSO with Duo MFA. **Precedence:** Decision of 2026-10-12 on #85 takes precedence: Choreo apps use Davidson SSO with Duo; the phishing-resistant requirement doesn't apply, and PE is raising it with InfoSec. |
| **4.10** No non-public data or derived artifacts in a repository that goes public | flag | flag | The assessor's full-history scan for real-data artifacts (samples, exports, screenshots, log excerpts, internal hostnames) before the repository goes public; `AGENTS.md` rule 5 forbids them. |

## 5. Pre-deployment technical review

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **5.1.1** Davidson SSO integration in place | n/a | platform | As 4.8. |
| **5.1.2** MFA enforced, including for admin roles at any tier | n/a | platform | As 4.9: every sign-in goes through Davidson SSO with Duo, whatever the role. |
| **5.1.3** Roles defined explicitly and mapped to what each user sees | n/a | check | The passport's `roles`, which a container app must list; they become its Entra app roles. |
| **5.1.4** Authorization tested: a lower role can't act as a higher one | n/a | attested | A ready-call attestation (#89); the assessor's client-side-authorization flag (4.3) backs it. |
| **5.1.5** Access roster reviewed at least quarterly | process | process | Quarterly access review reminder (Part 13, #36). |
| **5.1.6** Access revoked within 24 hours of leaving | process | process | App roles are Entra group assignments, so removal follows Entra offboarding; Choreo org membership is reconciled monthly (#87). |
| **5.1.7** Session expiration; no tokens in URLs | n/a | flag | Sessions come from the platform's authentication; the assessor flags tokens or secrets passed in URLs. |
| **5.2.1** The app's own permissions are the narrowest that work | n/a | flag | Security rubric: overly broad OAuth scopes and permissions. |
| **5.2.2** AI-generated integrations not defaulted to broad scopes | n/a | flag | As 5.2.1. |
| **5.2.3** Application permissions documented with a rationale | n/a | attested | Each passport integration names its purpose; the builder confirms the permissions and their reasons at the ready call. |
| **5.2.4** A dedicated credential per integration or service account | n/a | platform | Each app has its own managed identity and its own key vault. |
| **5.2.5** Service credentials in 1Password or replaced by managed identity; rotated | n/a | platform | Managed identity where Azure supports it; any remaining secret lives in the app's key vault. `AGENTS.md` rule 6. |
| **5.2.6** Own managed identity; RBAC at resource scope | n/a | platform | The hosting module gives each app its own managed identity with roles assigned on its own resources only. |
| **5.3.1** Secrets in 1Password or Key Vault, never in code or repositories | check | check | The secrets check; runtime secrets live in the app's key vault, read with its managed identity. |
| **5.3.2** A committed secret is rotated immediately | process | process | Decision 35: PE works with the builder to rotate it and rewrite the history before deployment; the exposed-secret runbook (#36). |
| **5.3.3** Runtime secrets from Key Vault with managed identity; one vault per app, RBAC mode | n/a | platform | The hosting module creates one RBAC-mode key vault per app, read through Key Vault references with the app's managed identity. |
| **5.3.4** App-managed encryption keys: procedures documented, keys stored apart | n/a | flag | Choreo apps use platform-managed keys; the assessor flags any app that manages its own. |
| **5.3.5** Deployment tokens stored as protected environment secrets | n/a | n/a | Choreo deploys with OIDC federated credentials, so there are no deployment tokens to store. Static Web Apps are out of scope. |
| **5.3.6** Storage shared-key access disabled | n/a | platform | The hosting module disables shared-key access on every storage account. |
| **5.4.1** WAF and SSO actually in the traffic path; origin not directly reachable | n/a | platform | As 4.7: Restricted and Confidential apps accept traffic only from the WAF. **Precedence:** As 4.7. |
| **5.4.2** CORS not wildcarded | check | check | The code check fails CORS open to any origin. |
| **5.4.3** Rate limiting on public-facing endpoints | n/a | flag | The assessor flags public endpoints without rate limiting. |
| **5.4.4** Key vaults and storage closed to the internet; firewalled to the subnet | n/a | platform | The hosting module closes public network access and, for Restricted and Confidential apps, firewalls them to AIToolsRestricted. |
| **5.4.5** Minimum TLS 1.2 set explicitly | n/a | platform | Set explicitly by the hosting module on storage and Container Apps. |
| **5.4.6** Egress reviewed; unrestricted egress only as a documented decision | n/a | flag | The assessor compares outbound calls in the code with the passport's `integrations`. |
| **5.5.1** Parameterized queries only | n/a | flag | Security rubric: injection. |
| **5.5.2** Output encoding against XSS | flag | flag | Security rubric: injection, including XSS in client-rendered pages. |
| **5.5.3** No user input in shell or system calls | n/a | flag | Security rubric: injection. |
| **5.5.4** Prompt injection can't alter instructions or trigger tools | flag | flag | Security rubric: prompt injection, run when the passport's `llm` is set. |
| **5.5.5** File upload validation, isolation and malware scanning | n/a | flag | Security rubric: file uploads. |
| **5.6.1** Logs capture authentication, privileged actions, data access and changes | n/a | flag | Sign-ins are logged by Entra and the platform; the assessor flags apps whose privileged actions and data changes aren't logged. |
| **5.6.2** Each log entry: who, what, resource, when, outcome | n/a | flag | As 5.6.1. |
| **5.6.3** 12-month log retention | n/a | platform | Set by the hosting module on the app's Log Analytics workspace. |
| **5.6.4** Logs tamper-evident | n/a | platform | Logs leave the app for Log Analytics and the SIEM, where the app's identity can't change them. |
| **5.6.5** Logs retrievable by InfoSec within a day or two | n/a | platform | As 5.6.6. |
| **5.6.6** Azure diagnostic logs forwarded to the SIEM | n/a | platform | The hosting module's diagnostic settings forward Key Vault, storage, Entra sign-in and app logs to the T&I SIEM. |
| **5.6.7** Anomalous-access alerting for Confidential data | n/a | platform | Defender alerting on Confidential apps' resources (decisions on #85). |
| **5.7.1** Patching: critical and high in 72 hours, the rest in 30 days | process | process | The findings sweep against the 72-hour and 30-day deadlines (Part 13, #36), and oversight's security rubric (#91). |
| **5.7.2** No end-of-life runtime or framework | check | check | The dependency check fails a Node or Python version past end of life, from `engines`, `.nvmrc` and the Containerfile. |
| **5.7.3** Endpoint protection on machines that access Davidson data | attested | attested | A ready-call attestation: a patched development machine running endpoint protection (#89). |
| **5.7.4** Developer devices meet the patching standard | attested | attested | As 5.7.3. |
| **5.8.1** Every new dependency exists on the registry | check | check | The dependency check looks each new dependency up on npm, failing a missing one and warning on one published in the last 30 days. |
| **5.8.2** Every dependency explained; unused ones removed | check | check | The build job runs knip and warns on unused dependencies; `AGENTS.md` rule 3 asks the builder to be able to explain each one. |
| **5.8.3** Dependency auto-merge disabled | check | check | The dependency check fails any workflow that turns on auto-merge. |
| **5.8.4** Production dependencies pinned exactly | check | check | The build job requires a lockfile and installs with `npm ci`; the package writes exact versions and `save-exact`. **Gap:** The checks don't yet fail a floating specifier, such as `^1.2.0`, in package.json. |
| **5.8.5** Changelog and CVEs reviewed before merging an update | process | process | The pull-request review comment gives Dependabot updates a changelog and CVE summary (#35), and auto-merge is off, so a person merges after reading it. |
| **5.8.6** Dependency updates tested in non-production first | process | process | Open with InfoSec: whether CI tests count as the non-production test (plan.md, "Open with Information Security"). |
| **5.8.7** SBOM generated at each release and stored | platform | platform | Planned with the deploy workflow. **Gap:** Nothing generates an SBOM yet. |
| **5.8.8** Subscribed to security advisories for dependencies | platform | platform | Dependabot alerts on every hosted repository; the report pulls in open alerts (#35). |
| **5.9.1** The build agent didn't hold dev and prod credentials together | attested | attested | `AGENTS.md` rule 6: the agent never holds production credentials. The builder confirms it at the ready call. |
| **5.9.2** Destructive actions needed human approval during the build | attested | attested | `AGENTS.md` rule 7: schema changes, data deletion and deploys need the builder's explicit approval. |
| **5.9.3** Production deploys use OIDC to a protected environment with a required reviewer | platform | platform | Deploys use OIDC federated credentials, with basic deployment authentication disabled, and run only from `main`. **Precedence:** Decision 25 (2026-10-12) has builders merge their own pull requests once the checks pass, and deploys run from `main` with no required reviewer. This item's required reviewer conflicts with it; to raise with InfoSec. |
| **5.9.4** No Davidson data used to train any AI model | attested | attested | A ready-call attestation; Claude Enterprise doesn't train on customer data. |
| **5.9.5** AI vendor configured not to train; only sanitized data in public AI tools | attested | attested | A ready-call attestation: only sanitized data in AI tools other than Claude Enterprise (#89). |
| **5.10.1** WCAG 2.1 Level AA | check | check | The accessibility check runs axe's WCAG 2.0 A and AA rules on the built pages; any violation fails (decision 36). **Precedence:** Decision 36 (2026-10-12) sets WCAG 2.0 AA, which Davidson is bound to; this item says 2.1 AA. To reconcile with InfoSec. |
| **5.10.2** Semantic HTML; everything works by keyboard | attested | attested | A ready-call attestation: a manual keyboard and screen-reader pass (#89); axe catches part of it automatically. |
| **5.10.3** Color contrast checked with a tool | check | check | axe's color-contrast rule, in the accessibility check. |
| **5.10.4** Text alternatives for non-text content | check | check | axe's image-alt and related rules, in the accessibility check. |
| **5.10.5** Automated accessibility testing in CI | check | check | The accessibility check runs axe in Chrome on every pull request and at the publish request. |
| **5.10.6** Manual screen-reader and keyboard testing | attested | attested | As 5.10.2. |
| **5.10.7** A VPAT for any vendor UI or embed | attested | attested | The builder confirms one at the ready call when the app embeds a vendor's interface. |
| **5.11.1** Every endpoint touching Davidson data requires authentication | n/a | platform | The platform's authentication sits in front of every route of a container app, so no endpoint is reachable unauthenticated. |
| **5.11.2** RBAC implemented and tested | n/a | attested | As 5.1.4. |
| **5.11.3** No endpoint protected only by an unguessable URL | n/a | flag | Security rubric: endpoints protected only by an unguessable URL. |
| **5.11.4** OWASP API Security Top 10 reviewed | n/a | flag | The security rubric covers the Top 10 items that apply. |
| **5.11.5** Input validation and output encoding on every endpoint | n/a | flag | Security rubric: injection and unvalidated input. |
| **5.11.6** Rate limiting per caller | n/a | flag | As 5.4.3. |
| **5.11.7** Error responses sanitized | n/a | flag | The assessor flags stack traces, file paths or raw database errors returned to callers. |
| **5.11.8** Incoming webhooks verify signatures | n/a | flag | Security rubric: webhook signatures. |
| **5.11.9** API documentation available to other Davidson teams | n/a | attested | The builder confirms it at the ready call when the app exposes an API to others. |
| **5.11.10** Rate limits on other Davidson teams documented first | n/a | attested | As 5.11.9. |
| **5.11.11** Machine-readable API contract (recommended) | n/a | flag | The assessor notes a missing OpenAPI contract as a low-severity flag, since the item is a recommendation. |
| **5.12.1** Each external API on the approved vendor list | flag | flag | As 3.7. |
| **5.12.2** TLS 1.2 or later on outbound calls | check | check | The code check fails plain `http://` calls. |
| **5.12.3** Outbound API keys stored in 1Password | check | platform | In the app's key vault, accepted as equal or stronger per 5.3.1; a Pages site holds no keys, which the secrets check confirms. |
| **5.12.4** Defined expiration and rotation for API credentials | n/a | attested | The builder confirms the rotation cadence for each integration's credential at the ready call. |
| **5.12.5** Data from external APIs validated, including for prompt injection | flag | flag | Security rubric: unvalidated data from outside APIs. |

## 6. Repository and code publication

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **6.1** History scanned for secrets before going public | check | check | The secrets check scans the full history at the publish request, before the repository goes public. |
| **6.2** No non-public data or derived artifacts anywhere in the repository or history | flag | flag | As 4.10. |
| **6.3** Non-public development data kept outside the repository | attested | attested | A ready-call attestation; `AGENTS.md` rule 5. |
| **6.4** Comments and docs reveal no internal infrastructure | flag | flag | The assessor's full-history scan includes comments and documentation; the passport names integrations by platform, never hostname. |
| **6.5** A private repository's justification documented | process | process | Hosted Choreo apps are public; a private exception is a conversation with PE, recorded in `spec.yaml`. |

## 7. Data lifecycle and decommissioning

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **7.1** Secure transfer methods only | check | check | The code check fails plain `http://`; the platform serves HTTPS only. |
| **7.2** Retention per data category, with automated deletion | n/a | platform | As 3.9. |
| **7.3** File aging for file-based integrations | n/a | platform | As 3.9: storage lifecycle rules delete files after the retention window. |
| **7.4** Decommissioning: data destroyed within 30 days of retirement, documented | process | process | The renewal sweep and sunset runbook: data destroyed within 30 days of retirement with a written record (Part 13, #36). |

## 8. Regulatory considerations

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **8.1** Applicable regulatory frameworks identified | check | check | As 3.10. |
| **8.2** Legal and InfoSec consulted before build where frameworks apply | process | process | Discovery routes any regulated data to a human, with InfoSec and Legal, before the build starts (#86). |
| **8.3** Incident notification owner identified | check | check | The passport's `incident_contact`, required by the passport check. |

## 9. Pre-deployment approval and sign-off

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **9.1** Tier-1 gate passed | process | process | The publish request's checks and the assessor's report (Section 4 items above). |
| **9.2** Data classification complete | process | process | Information Security's review of the report at the ready call. |
| **9.3** Pre-deployment code review completed | process | process | Information Security's review of the report's security section at the ready call. |
| **9.4** Repository and publication standards confirmed | process | process | The Section 6 items above, reviewed at the ready call. |
| **9.5** Data lifecycle plan documented | process | process | The Section 7 items above, reviewed at the ready call. |
| **9.6** Regulatory considerations reviewed | process | process | The Section 8 items above, reviewed at the ready call. |
| **9.7** Business owner confirmed in the passport | process | process | The passport's `business_owner`, confirmed at the ready call. |
| **9.8** Approvals recorded against the passport's exact content | process | process | The stamping script records approvals in `spec.yaml` and the approved passport's hash in `approved-passport-sha` (#89). |
| **9.9** Approver and date | process | process | The Kuali ready-call form records each approver and date (#89). |

## 10. Post-launch monitoring, testing and recertification

| Item | Pages | Container | How it is met |
|---|---|---|---|
| **10.1** Continuous vulnerability scanning once live | platform | platform | CodeQL, Dependabot and secret scanning on every hosted repository, which is public; oversight's security rubric reads their alerts monthly (#91). |
| **10.2** Container images scanned continuously | n/a | platform | Defender for container registries (decisions on #85). |
| **10.3** Critical and high findings remediated on the patching SLA | process | process | As 5.7.1. |
| **10.4** Periodic penetration testing | process | process | The pen test between approval and go-live, and the annual retest for High-tier apps (#89, #36). |
| **10.5** Re-review on any material change | process | process | A change to a passport field in `x-ready-call-fields` re-runs the ready call; oversight's drift check catches changes the passport doesn't show (#91). |
| **10.6** Access roster reviewed quarterly; unowned apps flagged | process | process | As 5.1.5; oversight's health rubric flags apps whose owners have left (#91). |
| **10.7** Annual recertification; unrecertified apps retire within a month | process | process | The renewal sweep (pipeline.md decision 16, #36). |
| **10.8** Each deploy confirms the passport is unchanged since approval | process | process | The deploy workflow refuses a passport whose hash isn't `approved-passport-sha`. |
