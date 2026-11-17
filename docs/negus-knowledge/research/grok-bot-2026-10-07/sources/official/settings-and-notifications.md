#### Manage and protect

# Settings and notifications

Use Grok Bot settings for app-wide and desktop-local behavior, and conversation
details for one Bot's profile and notifications.

## Open Grok Bot settings

Open the account menu and choose **Settings**, or press `Cmd/Ctrl+,`. For
other desktop shortcuts, including Bot settings (`Cmd/Ctrl+Shift+,`) and
conversation details, see
[Keyboard shortcuts](/grok-bot/chat-and-collaboration#keyboard-shortcuts).

The **Grok Bot settings** dialog contains sections based on your account and
rollout. Some options described below may not appear.

## General

### Account

Sign in or out of the Cursor account used by Grok Bot. The account menu also
shows **About**, the installed Grok Bot version, and **Get Grok Bot for
mobile**, which opens the App Store listing.

When more than one account is saved on the desktop, the account menu includes
**Switch account**. Choose **Add account** to save another. Settings lists
the same accounts; inactive rows include **Remove**.

### Appearance

Choose **Follow System**, **Light**, or **Dark**.

Use **Language** to choose **Follow System** or one of more than 20 app
languages, including English, Spanish, French, German, Japanese, Korean,
Simplified Chinese, and Traditional Chinese. On iPhone and Android the
follow-device option is labeled **System**, and the list is shorter. See
[Grok Bot for Mobile](/grok-bot/mobile).

### Bot

Configure shared and local Bot behavior:

* **Timezone**, which routines use for schedules
* **Execution on Local Computer**

Cursor manages model selection, so there is no model picker.

### Auto-review

Manage your personal Auto Review rules, plus any team rules your admin
requires.

Two settings in **General** deserve care. **Execution on Local Computer**
controls whether Bots can run commands on the desktop in front of you;
per-command approval is the default, and the setting applies to that desktop
alone. Auto Review rules shape which actions stop for your approval. When your
admin enforces Auto Review for the team, the same table also shows locked team
rules with `Required by your admin. You can't edit or delete this rule.` You
can add your own rules on top, but they only make behavior stricter; **Ask
first** wins when rules conflict. If your admin turns enforcement off, you only
see and use your own rules. Your personal rules are stored on the current
desktop and synced to its Grok Bot computer, so another desktop installation
needs its own. Read
[Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy)
before changing either.

## Computer

### Route traffic through your desktop

Turn on **Route egress through this desktop** to send your Grok Bot computer's
web traffic through the current desktop. Destinations see your desktop's IP
address, and the Bot can reach networks available from that device.

The setting applies to one desktop. If your Enterprise admin turns off **Allow
Local Egress**, the toggle turns off and locks with
`Your team's admin has turned off local egress.` Any active route stops within
five minutes. Your choice is preserved and takes effect again if the admin
re-allows local egress.

For private network options and their tradeoffs, see
[Connect to private networks](/grok-bot/private-networks).

## Plugins

Plugins are not a settings section. Open **Marketplace** from the sidebar to
discover plugins and packaged skills. To review what you have installed, choose
**Your plugins** in Marketplace; **Manage plugins and skills** lists your
**Installed** plugins and your **Private skills**.

An installed plugin may still need browser authentication. Individual plugin
tools can be enabled or disabled. On the Teams plan and the Enterprise plan,
team-provided plugins may be required or restricted by an admin.

See [Connect plugins](/grok-bot/computer-and-apps#connect-an-app) for the
connection flow.

## Usage and billing

**Usage & Billing** shows weekly included usage and on-demand usage for eligible
accounts, and the account menu can show **Weekly usage** at a glance. If neither
surface appears, review usage from the Cursor account page or contact your
organization's admin.

For how plans, weekly usage, and on-demand spend work, see
[Plans and billing](https://cursor.com/help/grok-bot/plans).

## Team Setup

Team Setup is Enterprise only. When an Enterprise admin provides a managed
setup for your team's computers, **Team Setup** shows it here so you can review
or reinstall it. Admins configure the manifests from the Cursor dashboard; see
[Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises#admin-controls).

## Updates

The update controls live in **Settings → Updates**. The Grok Bot app and Grok
Bot's computer update separately:

* **Grok Bot Updates** shows the installed version. **Check for Updates** and
  **Restart to Update** update the desktop app.
* Under **Grok Bot's Computer**, **Update** installs the latest software on the
  cloud computer and keeps your files in place.
* **Reset** wipes the computer and rebuilds it from your last saved snapshot, so
  very recent changes may be lost. Use it as a last resort.

See [Troubleshooting](/grok-bot/troubleshooting) for the least destructive
recovery order.

## Edit one Bot

Open **View conversation details**, then **Bot settings**, to edit that Bot's:

* **Name**, **Label (optional)**, and **Description**
* Avatar
* **Notifications** preference

These settings belong to one Bot. **Execution on Local Computer** is set per
computer, and your personal Auto-review rules are stored on each desktop.

## Understand attention states

The sidebar distinguishes:

* **Needs attention** for a question, approval, or handoff
* **Unread activity** for a new result
* Working or typing status

Opening a conversation marks its current activity as read. Use the Bot menu to
mark a conversation read or unread manually.

## Control notifications

Turn on **Notifications** in a Bot's settings to receive an operating-system or
mobile notification when that Bot finishes or needs input. Group chats do not
have the same per-Bot notification switch.

Notifications are normally suppressed while Grok Bot is focused. The sidebar
and dock badge still show unread activity.

The iPhone and Android apps also ask for notification permission during first
run. Both device permission and the Bot's notification setting must allow the
notification. Mobile push delivery is rolling out and may not yet be enabled
for every account.

## Handle in-app errors

Errors appear above the composer under **Notifications**. You can dismiss one
notice or clear the list. Some notices include **Copy request ID** for support;
copy and share the complete ID with
[support](/grok-bot/troubleshooting#before-contacting-support).

Clearing a notice removes the notification, not the underlying external action
or Bot history.

## Related pages

* [Keyboard shortcuts](/grok-bot/chat-and-collaboration#keyboard-shortcuts)
* [Use the computer and apps](/grok-bot/computer-and-apps)
* [Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy)
* [Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises)
* [Plans and billing](https://cursor.com/help/grok-bot/plans)
* [Remove access and working data](/grok-bot/approvals-security-and-privacy#remove-access-and-working-data)
