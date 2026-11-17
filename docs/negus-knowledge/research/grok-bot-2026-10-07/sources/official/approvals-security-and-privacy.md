#### Manage and protect

# Approvals, security, and privacy

Grok Bot is designed to complete work while keeping sensitive inputs and
consequential actions under your control. Use approvals, secure handoffs, and
clear Bot boundaries together.

## Set a boundary in the request

Tell the Bot which actions it can take and where it must stop:

> Reconcile the campaign data and draft a recommended budget change. Do not
> change the campaign or message the agency. Ask for approval after showing the
> current value, proposed value, and expected impact.

Prefer explicit boundaries for:

* Sending messages or invitations
* Publishing content
* Purchases and financial transfers
* Deleting or overwriting data
* Changing permissions
* Production changes
* Accepting legal terms

An approval controls the proposed action. It does not reverse work already
completed.

## Review an action

When an action needs approval, the conversation shows the proposed operation
and its inputs. Review the target, scope, and values before approving.
**Allow once** lets the Bot continue with that action, **Always allow** can
save a matching rule, and **Deny** blocks it. The controls are the same on
iPhone.

Do not approve an action whose target or effect you cannot identify. Ask the Bot
to explain it in plain language or produce a draft first.

## Configure Auto Review

With Auto Review on, Grok Bot evaluates tool calls and computer actions before
they run. Open **Settings → General → Auto-review** to add rules.

* **Ask first** rules always stop matching actions for you.
* **Allow automatically** rules let matching actions proceed only when the
  automated review does not identify another reason to stop.
* If both kinds of rule match, **Ask first** wins.

If your team admin enforces Auto Review, the same table also shows locked team
rules that you cannot edit or delete. Your own rules apply on top and can only
make behavior stricter. See
[Auto-review rules](/grok-bot/teams-and-enterprises#auto-review-rules).

Write narrow rules around a known action and scope:

* Ask first before sending any external email.
* Ask first before changing a production dashboard.
* Allow automatically when running `git status` in `/workspace/reports`.

Avoid broad rules such as “allow everything in the browser.” Websites and tool
behavior change over time. Auto Review is model-based and should complement,
not replace, least privilege and explicit approval boundaries.

Personal Auto-review rules are stored on the current desktop and synced to its
Grok Bot computer, so another desktop installation needs its own.

## Enter passwords and verification codes yourself

For passwords, passkeys, two-factor codes, CAPTCHAs, and payment confirmations,
the Bot should hand you control of the computer.

1. Open **Agent Computer**.
2. Take control.
3. Complete the sensitive step.
4. Return control and tell the Bot to continue.

Do not send a password or one-time code in ordinary chat.

If the Bot presents a secure secret request for a supported connection, enter
the value in that request. It is not a general-purpose password manager. The
value is masked, excluded from the transcript, and not shown to the model.

When a web page needs you to type something yourself, such as a login, a
checkout address, or a phone number, the Bot can show a form in the chat, one
form per step, and fill your answers into the page for you.

If you sign in with a hardware security key, such as a YubiKey, the Bot's
browser can use a key plugged into your desktop while **Use hardware security
keys** is on under **Settings → General → Security Key**. The setting is on by
default on macOS and Windows and is not yet supported on Linux; every use asks
you to approve it first.

## Control access to your local computer

The shared Grok Bot computer runs in the cloud. Access to the Mac or Windows
computer in front of you is a separate capability.

In **Settings → General → Bot → Execution on Local Computer**, choose
**Ask every time**, **Always allow**, or **Never allow**. Once your account has
registered computers, the choice moves to **Settings → Computer → Computers**,
where each computer has its own **Execution on this computer** setting.

The default is **Ask every time**. Use **Never allow** unless a Bot has a
specific reason to work on your local files. Your team admin can cap this
setting for the whole team; when the team's policy is stricter than yours, the
team's applies. These settings do not prevent the Bot from using its cloud
computer.

The first time a Bot asks to run a command on your computer, the conversation
shows **Allow Grok Bot and all Bots to run commands on your local computer?**
with **Always allow**, **Allow once**, **Never**, and **Deny once** (Esc).
**Always allow** and **Never** set **Execution on Local Computer** for every
Bot, and you can change the setting later in Settings. If your team's admin has
set a stricter ceiling, **Always allow** is unavailable.

## Understand the shared-computer boundary

All of your Bots share one cloud computer assigned to your user account. Files,
browser sessions, and command line credentials on that computer are available
across your Bot roster.

* Do not use separate Bots as a security boundary.
* Sign out of a service when it should no longer be available.
* Remove sensitive temporary files after the work is complete.
* Delete a connector or revoke its authorization in the source service when
  access is no longer needed.

Do not treat this user assignment as a guarantee that is broader than Cursor's
published security documentation. Review current infrastructure and encryption
controls there.

## Sharing a Bot is not a security boundary

A public share link lets others copy the Bot's configuration. It does not share
your computer or logins. Still, do not put secrets, customer data, or internal
URLs in a Bot you share. See [Share a Bot](/grok-bot/bots#share-a-bot) and the
[third-party bot terms](https://x.ai/legal/bot-sharing-terms).

## Cursor account and data settings

Grok Bot uses Cursor authentication and account data settings.

* Grok Bot requires data storage and does not support Legacy Privacy Mode.
* Privacy and data-sharing choices are managed through Cursor account settings
  and, when required, the Grok Bot access flow.
* Training opt-out follows the applicable Cursor account and privacy settings.
* Review the current [Cursor Privacy Policy](https://cursor.com/privacy) and
  [security information](https://cursor.com/security) for contractual details.

Organization administrators can restrict local-computer execution and may
provide managed setup for the cloud computer. Available controls depend on the
organization's rollout and plan.

## Remove access and working data

When a project or login should no longer be available:

1. Pause or delete related routines.
2. Sign out of websites on the shared computer.
3. Uninstall connectors and revoke their authorization in the source service.
4. Remove sensitive project files from `/workspace`.
5. Hide or delete Bots that should no longer appear in Grok Bot.
6. Use the account settings flow if you need to delete the Cursor account.

Deleting a Bot does not remove shared-computer files or browser sessions.
Backend retention and account deletion follow the applicable Cursor terms.

## Use a least-privilege setup

* Connect only the tools a workflow needs.
* Use scoped service accounts where the source system supports them.
* Start with read-only tasks and draft outputs.
* Keep sending, publishing, purchasing, deletion, and production changes behind
  approval.
* Review installed connectors and active routines regularly.
* Pause a routine when its source system or expected workflow changes.
* Preserve source links and an action log for important decisions.
