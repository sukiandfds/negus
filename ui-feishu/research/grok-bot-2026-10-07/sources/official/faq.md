#### Help

# Frequently asked questions

## How is Grok Bot different from an AI assistant?

Bots can use a persistent cloud computer, connected tools, websites, and
files to complete work—not only answer questions. They can continue in the
background, keep role-specific context, and coordinate with other Bots.

## Where do I talk to Grok Bot?

Use the Grok Bot desktop app on macOS, Windows, or Linux, or the companion
app on iOS or Android. The same Bots and conversations sync across your
signed-in devices.

## Does Grok Bot keep working when my laptop is closed?

Yes. Bot work runs on the cloud computer. Closing the app, laptop, or phone
does not stop a background turn or routine.

## Do my Bots share one computer?

Yes. Every Bot on your account uses one persistent cloud computer. They share
its files, browser sessions, and logins so they can hand work off.

The computer is assigned per user, not per Bot. Do not use separate Bots as a
security boundary.

## Can several Bots work at the same time?

Yes. Bots can reason, use connectors, work with files, and coordinate in
parallel. Each Bot gets its own screen on the shared computer. One Bot can run
one computer-use task on its screen at a time.

## What does a Bot remember?

A Bot can retain stable preferences, role context, and summaries of prior work.
Its conversation and learned role are separate from other Bots, while shared
files, browser sessions, group messages, and direct handoffs can move context
between them.

For important decisions, ask the Bot to check the current source rather than
relying on memory.

## Can Grok Bot use any website?

Grok Bot can use many browser-based tools, including services without a
dedicated connector. A site may still block automation, require a new login,
present a CAPTCHA, or require human confirmation. The Bot should hand those
steps to you rather than bypassing them.

Use a connector when one is available for a more structured and reliable
integration.

## What actions require my approval?

The answer depends on the tool, the risk of the action, and—when enforcement is
enabled—your Auto-review rules. Sensitive or consequential actions can stop for
approval. Passwords, two-factor codes, CAPTCHAs, and similar human-only steps
use a computer takeover.

Put standing boundaries in each Bot's description and add narrow **Ask first**
rules for actions such as sending, publishing, deleting, purchasing, or
changing production systems.

## How does Grok Bot handle data and privacy?

Grok Bot uses Cursor authentication and account data settings. Training opt-out
follows the applicable Cursor account and privacy settings.

Grok Bot requires cloud data storage, so Legacy Privacy Mode is not supported.
All of your Bots can access the same cloud computer assigned to your account. See
[Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy) for the
full boundary and links to current Cursor security information.

## How much does Grok Bot cost?

Availability and billing depend on the account and plan. Grok Bot is included
with every paid individual Cursor plan and with the Cursor Teams plan, and you
can link an individual SuperGrok, SuperGrok Plus, or SuperGrok Heavy
subscription. Grok Bot subscriptions include weekly usage; eligible
accounts can add on-demand usage billed from model and token cost. If you have
both a Cursor and a SuperGrok subscription, Grok Bot uses whichever has more
usage. Review the current access page or
[Cursor pricing](https://cursor.com/pricing) for current terms. Enterprise
customers should contact their Cursor account team.

## Is Grok Bot available to teams and enterprises?

Self-serve Cursor Teams Standard and Premium seats include Grok Bot.
Enterprise access is rolling out. Availability and administrative controls can
vary by organization. Contact your Cursor account team for current enterprise
access.

## Can I dictate or talk to a Bot?

Yes. On desktop, press `Cmd/Ctrl+D` or choose **Start voice input** to dictate
into the composer. On iPhone and Android, dictate with **Start dictation**.
**Start voice chat** starts a live conversation on desktop, iPhone, and
Android. Bots can also send a **voice memo** you can play in the transcript.

## What keyboard shortcuts does the desktop app have?

See [Keyboard shortcuts](/grok-bot/chat-and-collaboration#keyboard-shortcuts).
Dictate uses `Cmd/Ctrl+D`. Settings uses `Cmd/Ctrl+,`. **Start voice chat** is
a button and has no keybinding.

## Can I change the app language?

Yes. Open **Settings** and choose **Language**. On desktop the picker includes
**Follow System** and more than 20 languages. On iPhone and Android the
follow-device option is labeled **System**, and the list is shorter.

## Can I use more than one account?

On desktop, open the account menu and choose **Switch account** or **Add
account**. Settings lists the same accounts; inactive rows include **Remove**.

## Which platforms are supported?

* macOS on Apple silicon and Intel
* Windows on x64 and Arm64
* Linux on x64 and Arm64, as a `.deb` package, an `.rpm` package, or an
  AppImage
* iPhone on iOS 18 or later
* Android 9 or later

The iOS app also runs on iPad with iPadOS 18 or later.

## What is the difference between a skill and a routine?

A **skill** describes how to perform a task. A **routine** assigns a workflow to
one Bot and tells it when to run—on a schedule or, where supported, after an
event.

Test the skill on a real one-time task before turning it into a routine.

## Can I show a Bot how I do a task?

When **Teach a task** is available, record one browser workflow from the
computer view. The Bot turns the demonstration into a draft skill that you can
review and test. The rollout may be gradual, and the recording is limited to
ten minutes.

## Can I share a Bot with someone else?

Yes. Open the **Share menu** and choose **Create template**, then **Copy link**,
and pick who can open it: **Public link** or **Team-only** (Enterprise accounts
default to Team-only). Anyone who can open the link can preview it on
[x.ai](https://x.ai) and add a copy to their account. They do not get your
computer, logins, or conversation history.

The link exposes the Bot's configuration. Strip secrets and anything
confidential before you share. Adding a shared Bot accepts the
[third-party bot terms](https://x.ai/legal/bot-sharing-terms). See
[Share a Bot](/grok-bot/bots#share-a-bot).

To give the team one Bot they all talk to, rather than a copy each person
customizes, publish a [Team Bot](/grok-bot/team-bots).

## What happens if I delete a Bot?

Deletion removes the Bot's active profile, conversation, and routines from Grok
Bot. Because Bots share a computer, files and logins on that computer may
remain. Backend retention follows the applicable Cursor terms. Hide the Bot
instead if you may need its work later.
