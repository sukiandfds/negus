#### Manage and protect

# Grok Bot security

Use these controls and deployment details to decide whether Grok Bot is allowed
in, and to limit what Bots can access, change, and retain. Rollout steps and
the dashboard settings list live on
[Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises), and
common review questions are on the
[Grok Bot security FAQ](/grok-bot/security-faq).

> **Enterprise only** on the Grok Bot dashboard: the organization-wide enable
> switch, **Network Controls**, **Team Setup**,
> [**Team Secrets**](/grok-bot/teams-and-enterprises#team-secrets),
> **Action Recording**, **Allow Local Egress**, **Enforce Auto-review** with
> its team rules, and computer management for organization admins. Audit logs,
> OpenTelemetry Export, the MCP allowlist, and SCIM are also Enterprise only.
> Self-serve Teams do not see those settings. The full list is under
> [admin controls](/grok-bot/teams-and-enterprises#admin-controls).

## Network policy

**Network Controls is Enterprise only.** Admins set a Grok Bot network policy
from the [Grok Bot page](https://cursor.com/dashboard/bot) of the Cursor
dashboard. It controls which destinations team computers can reach. Self-serve
Teams do not see this panel and cannot set a destination allowlist. Teams
without a policy default to allow-all.

| Mode | Effect |
| --- | --- |
| **No Policy (Allow All)** | Allow all (the default for teams without a policy) |
| **Allow All Network Access** | Explicitly allow all destinations |
| **Defaults + Team Allowlist** | Cursor's default destinations plus your list |
| **Team Allowlist Only** | Only your list, plus the destinations a computer needs to function |

* **Destinations** cover web domains as well as IP ranges with ports for raw
  connections, with no cap on the number of entries.
* **Directory groups. Enterprise only, inside Network Controls.** Groups can
  set their own network policy, which replaces the team's for their members,
  and a lock makes the team policy effective for everyone.
* **The policy is separate from Cloud Agent network settings.** Running
  computers apply changes automatically within about a minute. Sleeping
  computers apply changes when they next wake. You do not need to recreate the
  computer.
* **Restricting egress limits where data can be sent.** Dedicated data loss
  prevention hooks are not available.

Blocking a plugin does not block that service's website. The
[connector policy](/grok-bot/teams-and-enterprises#connector-policy) and the
network policy are separate layers, and closing both paths takes both controls.

## Static egress IPs

Hosted computers reach the internet through shared static egress IP addresses
by default. The ranges are shared across Grok Bot customers, and dedicated
per-customer IPs are not available, so treat the ranges as identifying Grok Bot
traffic rather than your team alone. Current ranges are available from your
account team, and the product control is the destination allowlist rather than
a source IP editor.

If member devices sit behind Zscaler or another TLS-inspecting gateway, allow
Cursor's domains and exempt them from inspection on every profile, including
off-network. See [Configure TLS-inspecting proxies](/grok-bot/proxies).

Members can route traffic through their desktop to use its network and IP
address. **Team Setup is Enterprise only.** Those teams can also install their
own networking client on every team computer. Both paths are separate from the
shared egress ranges. See
[Connect to private networks](/grok-bot/private-networks).

## Approvals and Auto Review

Approvals keep consequential actions under the member's control. The strongest
boundary is the one in the request itself, so have members state what a Bot
may change and where it must stop:

> Reconcile the campaign data and draft a recommended budget change. Do not
> change the campaign or message the agency. Ask for approval after showing the
> current value, proposed value, and expected impact.

When an action needs approval, the conversation shows the proposed operation
and its inputs. **Allow once** lets the Bot continue with that action,
**Always allow** can save a matching rule, and **Deny** blocks it. The controls
are the same on iPhone. An approval controls the proposed action, not
work already completed, and nobody should approve an action whose target or
effect they cannot identify.

Auto Review is the review layer behind those prompts: an independent review
model that evaluates risky Bot actions before they run, covering shell
commands, plugin calls, computer use, automation writes (changes to routines
and event triggers), and delegation such as Cloud Agent and subagent launches.
It can let an action proceed, require approval, or deny it.

* **Team admins can enforce Auto-review. Enterprise only.** The switch lives
  on the Grok Bot page of the Cursor dashboard. When it is on, members cannot
  turn Auto-review off, unless a group they belong to lifts the lock with
  **Don't enforce for this group**; see
  [Enforce Auto-review](/grok-bot/teams-and-enterprises#enforce-auto-review)
  and [Group settings](/grok-bot/teams-and-enterprises#group-settings).
* **Admins can add team Auto-review rules. Enterprise only.** These live on
  the Grok Bot page too. They apply to every member's Bots, show up as locked
  rows in the member settings table, and save automatically when an admin
  adds, edits, or deletes a rule. If admins turn enforcement off, the team
  rules stop applying and members go back to their own rules only. See
  [Auto-review rules](/grok-bot/teams-and-enterprises#auto-review-rules).
* **Members can add personal rules** under **Settings → General →
  Auto-review**. **Ask first** rules always stop matching actions, and
  **Allow automatically** rules let matching actions proceed only when the
  reviewer finds no other reason to stop. Members can add personal rules on
  top of team rules, but they only make behavior stricter; **Ask first** wins
  when rules conflict. Keep rules narrow and tied to a known action, like "ask
  first before sending any external email" or "allow automatically when
  running `git status` in `/workspace/reports`". Avoid broad rules like "allow
  everything in the browser". Personal rules are stored on the current desktop
  and synced to its Grok Bot computer, so another desktop installation needs
  its own.
* **It does not review every side effect.** Memory writes and most settings
  changes are examples. Treat it as a complement to explicit boundaries and
  least privilege, working alongside controls that do not depend on a model's
  judgment: per-action approvals, the network policy, and per-user isolation.

For the member-facing walkthrough of these prompts and rules, see
[Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy).

## Identity and sign-ins

Members sign in to Grok Bot with their Cursor account, so your existing Cursor
SSO configuration applies. SAML 2.0 single sign-on works with Okta, Microsoft
Entra, Google Workspace, and OneLogin, and SSO can be required for all members
(which blocks password login). **SCIM is Enterprise only:** SCIM 2.0
provisioning and deprovisioning. For step-by-step Okta and Entra ID
configuration, including app assignment and sign-in rules for the computer
browser, see [Configure identity and access](/grok-bot/identity-and-access).

Inside the hosted computer, members sign in to applications through your own
identity provider in the browser, comparable to enrolling a new laptop. Your
session policies govern those sessions, and revoking the user in your identity
provider ends them.

A Bot has no identity or credentials of its own:

* **Bots act as the signed-in member.** A Bot can never hold more access than
  the person it belongs to, every action stays attributable to a named member,
  and there is no separate machine identity outside your identity provider to
  provision, rotate, or audit. Team-managed connectors are the one exception:
  they may use team or service-account credentials.
* **Connector tokens stay on Cursor's backend.** Bots invoke tools without
  receiving OAuth tokens, and tokens are never stored on the computer.
* **Credentials stay with the member.** For login, two-factor, and payment
  steps, the Bot hands the computer to the member rather than typing
  credentials. For supported connections, a secure secret request masks the
  entered value and keeps it out of the transcript and away from the model;
  passwords and one-time codes never belong in ordinary chat. See
  [Store secrets securely](https://cursor.com/help/grok-bot/secrets) and
  [Enter passwords and verification codes yourself](/grok-bot/approvals-security-and-privacy#enter-passwords-and-verification-codes-yourself).

To end a member's current work, an organization admin terminates the member's
computer from the dashboard; see
[Manage Grok Bot computers](/grok-bot/computers). That control is Enterprise
only. It stops running Bots, keeps the durable disk, and the member's next
session starts a fresh computer. It does not remove access. To remove access,
remove the member from the team or turn off Grok Bot for their group, and
revoke their sessions in your identity provider. Application sessions persist
only on the member's computer.

When a project or login should no longer be available, members clean up
directly: pause or delete related routines, sign out of websites on the
computer, uninstall plugins and revoke their authorization in the source
service, and remove sensitive files from `/workspace`. Deleting a Bot does not
remove computer files or browser sessions.

## Logging and audit

Audit Logs and Action Recording use separate pipelines. Audit Logs cover
administrative and security events, including Grok Bot control-plane actions.
Action Recording captures Bot actions, and OpenTelemetry Export sends those
events to your collector when configured, tagged `cursor.surface=grok_bot`.

* **Audit logs. Enterprise only.** They cover admin, security, and
  authentication events, plus Grok Bot control-plane events: Bot creation,
  member access changes, Team Setup manifests, MCP authentication, Slack
  account links, and routines. Filter them by application in the dashboard, or
  stream them to your SIEM. Self-serve Teams do not get this log.
* **Action Recording. Enterprise only.** It is a setting on the Grok Bot page,
  off by default. When a team enables it, Cursor records Bot actions, including
  scrubbed shell commands, in an internal store with a 90-day retention. Action
  Recording events do not appear on the Audit Log page. To receive the
  sanitized events in your own collector, configure
  [OpenTelemetry Export](https://cursor.com/docs/enterprise/opentelemetry-export),
  which is also Enterprise only. Exported records may include the member's
  email; it is not exported for teams on Privacy Mode (Legacy), which also
  forces recording off.
* **Conversation content export. Enterprise only, opt-in.** OpenTelemetry
  Export can also send the text of user prompts and assistant responses, and
  the arguments and results of hosted MCP tool calls. It is off until an admin
  allows it for the team and turns it on for the destination. Known credential
  shapes, PEM blocks, and email addresses are redacted before export, but
  pattern matching cannot catch every secret. See
  [Conversation content export](/grok-bot/teams-and-enterprises#logging-and-audit).

## Endpoint tooling

Grok Bot does not ship a built-in customer-facing telemetry or EDR feed. The
computers are Cursor-operated infrastructure that Cursor monitors for
operational health and abuse, and that telemetry deliberately excludes customer
data. **Team Setup is Enterprise only.** Those admins can install their own
tooling on every team computer.

## Data retention and deletion

Each member's computer keeps local files, browser sessions, and anything saved
in the browser on a durable disk across sessions. Connector tokens are never
stored on the computer.

* **Idle computers hibernate automatically.** Hibernation is not deletion.
* **Image updates preserve files.** Computers on a stale system image are
  recreated on the fresh image with member files preserved.
* **Member resets keep synced data.** Members can reset their own computer
  from the desktop app. Reset keeps the synced durable data, and recent
  unsynced work can be lost. See
  [Update, recover, or reset the computer](/grok-bot/computer-and-apps#update-recover-or-reset-the-computer).
* **Deletion follows the DPA.** Under the
  [Data Processing Agreement](https://cursor.com/terms/dpa), data is deleted or
  returned within 30 days of written direction after the service ends.
* **Backups run daily.** Cursor's production control plane is covered by daily
  encrypted backups, replicated to a separate recovery facility.

A per-organization retention policy and customer-managed point-in-time restore
of an individual computer are not available.

## Data residency

Grok Bot computers run in the United States today. That is not the same as
Cursor's
[US-only data residency](https://cursor.com/docs/enterprise/privacy-and-data-governance#data-residency)
program, which does not apply to Grok Bot by default. If your review needs a
written residency commitment, contact your account team.

## Models and data

Cursor manages model selection. There is no customer-facing model picker, and
the serving mix can change over time with no fixed vendor set guaranteed. Usage
analytics show the model that served each request, including failovers, and
billing follows the serving model.

* **The team model allowlist is Enterprise only, and enforcement is not
  guaranteed.** The list is honored by default. Onboarding presents an
  acknowledgement that Grok Bot may not follow it, so treat enforcement as
  configuration dependent. See
  [model access control](https://cursor.com/docs/enterprise/model-and-integration-management#model-access-control).
* **Privacy Mode applies.** While a member is on your team, the team's privacy
  mode governs them, and with Privacy Mode enabled, customer data is not used
  for training.
* **Zero Data Retention follows Cursor's existing provider agreements.** Model
  providers do not keep prompts or outputs, and Grok Bot adds no separate
  control. Providers may run abuse and safety classifiers, and flagged data
  may be stored for investigation.

If your contract limits which subprocessors can handle your data, contact your
account team before rolling out Grok Bot.

## Local execution

Bots can act on a member's own machine through the desktop app: run commands,
read files, and move files between the cloud computer and the local machine.
This is separate from work in the hosted computer, with its own control, and
it is distinct from Auto Review, which governs work inside the hosted computer.

Per-command approval is the default, and the approval card shows the exact
command. Members choose the policy under
**Settings → General → Bot → Execution on Local Computer** (or per computer
under **Settings → Computer → Computers**): **Ask every time**, **Always
allow**, or **Never allow**. Recommend **Never allow** unless a Bot has a
specific reason to work on local files. Admins can cap the policy for the
whole team with
[Execution on Local Computer](/grok-bot/teams-and-enterprises#execution-on-local-computer)
on the Grok Bot page; a member's own setting still applies when it is
stricter. For the member-facing steps, see
[Control access to your local computer](/grok-bot/approvals-security-and-privacy#control-access-to-your-local-computer).

## Hosting

Grok Bot runs only on Cursor-hosted cloud computers. On-premises deployment,
deployment inside your own perimeter, and bring-your-own-image deployment are
not supported today. Hosted computers use shared static egress by default.
Members can route traffic through their desktop, and Enterprise teams can
install a networking client with **Team Setup**. See
[Connect to private networks](/grok-bot/private-networks).

## Prompt injection

Content a Bot reads from the outside world, like web pages, plugin results, and
command output, can try to steer it. Grok Bot layers defenses: Auto Review
checks Bot actions against the member's request when enforcement is on, and
beneath it sit controls that do not depend on any model's judgment, including
the network policy, per-action approvals, and per-user isolation. Outside
content is marked as untrusted data when presented to the model. These controls
reduce, but do not eliminate, risk from malicious content, which is another
reason to keep consequential actions behind approval.

## Certifications

Anysphere, the company behind Cursor, holds ISO/IEC 27001 and ISO/IEC 42001
certifications, issued by Schellman, and Grok Bot is included in the current
ISO scope. ISO/IEC 27001 certifies the information security management system,
the security program of the whole organization. ISO/IEC 42001 certifies the AI
management system, how Cursor governs the AI it builds and operates.
Certificates and reports are available at
[trust.cursor.com](https://trust.cursor.com).

## Related pages

* [Grok Bot security FAQ](/grok-bot/security-faq)
* [Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises)
* [Configure identity and access](/grok-bot/identity-and-access)
* [Connect to private networks](/grok-bot/private-networks)
* [Configure TLS-inspecting proxies](/grok-bot/proxies)
* [Manage Grok Bot computers](/grok-bot/computers)
* [Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy)
* [Privacy and Data Governance](https://cursor.com/docs/enterprise/privacy-and-data-governance)

Contact your Cursor account team about egress ranges, residency commitments,
and security review support.
