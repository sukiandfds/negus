#### Start

# Use cases

The best Grok Bot roles own a repeatable outcome, not a loose category of
questions. Start with read-and-prepare work, review the result, then add
approved actions or a routine.

## Sales Outbound

**Owns:** account research, contact prioritization, and review-ready outreach.

**Connect:** customer relationship management (CRM), product-intent sources,
company websites, email, and professional networks as permitted by their terms.

**Start with:**

> Research the 25 accounts in this CRM view. Score them against our ideal
> customer profile (ICP) and recent intent, identify up to three relevant
> contacts per account, and draft email and LinkedIn outreach in the style
> examples attached. Skip anyone already in an active sequence. Return a review
> list; do not send or enroll anyone.

After the output is reliable, create a nightly research routine that stops at
the review list.

## Talent Scout

**Owns:** sourcing, candidate research, outreach drafts, and scheduling
preparation.

**Connect:** applicant tracking system (ATS), approved sourcing tools, email,
and calendar.

**Start with:**

> For this role description, find 20 potential candidates who meet the must-have
> criteria. Exclude anyone already in our ATS, explain the evidence for each
> match, and draft personalized outreach in my voice. Do not contact anyone.

Add approvals before external outreach, and have the Bot respect candidate
privacy, regional requirements, and source terms.

## Paid Media

**Owns:** campaign monitoring and budget recommendations.

**Connect:** advertising platforms, analytics, budget spreadsheet, and Slack.

**Start with:**

> Pull current spend and performance by campaign. Compare it with the monthly
> budget and target customer acquisition cost (CAC), then recommend
> reallocations with the supporting
> numbers. Draft a Slack update for the growth team. Do not change budgets or
> send the message.

Keep campaign changes behind approval even after the analysis becomes a
routine.

## Expense Manager

**Owns:** weekly expense reconciliation and missing-information follow-up.

**Connect:** expense system, email, shared drive, and finance spreadsheets.

**Start with:**

> Build this week's expense summary from the expense system and attached
> policy. Match receipts from the finance inbox, flag missing categories or
> policy exceptions, and draft one follow-up per owner. Return the summary and
> drafts; do not send messages or change reimbursements.

Ask for policy citations on every exception and totals that reconcile back to
the source.

## Product Performance

**Owns:** targeted performance investigations with evidence.

**Connect:** observability, analytics, incident tooling, and source-control
links.

**Start with:**

> Investigate the checkout latency increase since yesterday's release. Review
> dashboards, traces, and flamegraphs; identify the highest-confidence hotspot;
> and return a short write-up with screenshots and direct links. Separate facts
> from hypotheses. Do not change alerts or production settings.

Use a routine for a recurring health report, not for unsupervised production
changes.

## Bug Reproduction

**Owns:** turning reports into reliable reproduction packs.

**Connect:** issue tracker, staging environment, browser, and network tools.

**Start with:**

> Read this bug report and reproduce it in staging using a fresh test account.
> Return exact steps, expected and actual behavior, screenshots, browser and OS
> details, relevant console or network notes, and a minimal test case if
> possible. Do not use production customer data.

Provide approved test credentials through a secure handoff, not chat.

## Account Health

**Owns:** risk and expansion signals across a customer portfolio.

**Connect:** CRM, product usage, support, billing, and customer-success notes.

**Start with:**

> Review the accounts in this portfolio. Combine recent usage, support
> escalations, renewal timing, and stakeholder activity into a ranked watch
> list. For each account, include the evidence, why it matters, and a suggested
> next step. Do not contact customers or edit the CRM.

Define risk thresholds in the Bot description so the weekly result stays
consistent.

## Chief of Staff

**Owns:** a source-linked digest of what changed and what needs attention.

**Connect:** Slack, email, calendar, meeting notes, and planning documents.

**Start with:**

> Review activity since yesterday across my approved channels, inbox, calendar,
> and meeting notes. Return only items that map to the priorities in this
> document. For each item, include the source, why it matters, the proposed next
> step, and whether I owe a decision. Do not send messages or change meetings.

Tune the Bot by marking what was useful and what was noise. Then schedule the
digest for a time you can review it.

## Turn an example into a durable Bot

For any role:

1. Put the job, source systems, output format, and standing boundaries in the
   Bot description.
2. Run one real task with a safe scope.
3. Correct the result until it is reviewable.
4. Save the successful process as a skill.
5. Test it on a second input.
6. Create a routine only when retries and failure cases are defined.
7. Keep consequential external actions behind approval.

Continue with [Get started](/grok-bot/get-started), then review
[files and results](/grok-bot/files-and-results) and
[approval boundaries](/grok-bot/approvals-security-and-privacy).
