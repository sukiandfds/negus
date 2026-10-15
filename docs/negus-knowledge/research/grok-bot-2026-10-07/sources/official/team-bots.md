#### Work with Grok Bot

# Team Bots

A Team Bot is one Bot that your whole team talks to. Its owner sets it up once,
with the plugins, secrets, skills, and files it needs, and publishes it to the
team. Every teammate can then chat with it in the Grok Bot app or in Slack
without starting from scratch.

## Why use Team Bots?

A Bot becomes useful as you teach it: the tools it can reach, the way your team
works, and the details it keeps getting wrong. On a personal Bot, that work
helps one person. A Team Bot shares it:

* **You set it up once, and everyone uses it.** The plugins, secrets, skills, and files
  the owner adds are available in every teammate's conversation.
* **It learns from the team.** When someone tells the Bot something the whole
  team should know, it saves it to team memory, which every teammate's
  conversation reads.
* **Every conversation stays private.** Each teammate gets their own chat. The
  owner can't read teammates' chats, and teammates can't read the owner's.
* **It acts as the person asking.** A plugin that needs a sign-in uses the
  account of whoever is talking to the Bot. A Team Bot never lends one
  person's access to another.
* **It can have its own Slack app.** Teammates DM it or @mention it, and it
  posts as itself.

Team Bots suit one shared job, such as answering metrics questions from your
data warehouse, keeping docs current as PRs ship, triaging requests posted in
a Slack channel, or answering internal helpdesk questions from a knowledge
base. For an everyday assistant that works from your own accounts and
memories, keep a personal Bot.

### Team Bots, personal Bots, and public templates

|  | Personal Bot | Public template | Team Bot |
| --- | --- | --- | --- |
| Who talks to it | Only you | Each person who adds it talks to their own copy | Everyone on your team, each in their own chat |
| Who maintains it | You | Each copy's new owner, separately | The owner, and changes reach everyone |
| Memory | Yours | Starts from what the template shares, then separate per copy | Team memory, plus private notes with each person |

## How to access

Team Bots are available to members of a team. Create, set up, and
publish them in the Grok Bot desktop app. Teammates can use a published Team
Bot from the desktop app, the [mobile app](/grok-bot/mobile), and Slack.

If your account can't use Team Bots, opening a Team Bot link shows **Team Bots
Not Available**.

## Create a Team Bot

1. Choose **New chat** in the sidebar or press `Cmd/Ctrl+N`.
2. In **New chat**, choose **Create new Team Bot**.
3. The Bot opens its own chat, asks what the team needs it for, and walks you
   through plugins, secrets, skills, and files.
4. Give it a concrete job and try it on real tasks. Correct it as you go.

Until you [publish it](#publish-a-team-bot), only you can see the Team Bot.
Each teammate who opens it later gets their own chat. That chat starts
without this conversation and includes the plugins, secrets, skills, files,
and memory you saved for the team.

### Start from a Bot you already have

If a personal Bot already does work the team would share, make a team copy of
it:

1. Open the Bot's **Share** menu and choose **Publish to Team**.
2. The Bot checks what a copy would start from: this chat and its own
   memories.
   * If most of those memories are personal facts about you, such as your
     family, health, or schedule, or the chat is about your own life or
     individual work, it asks **How should your Team Bot start?** Choose
     **Copy** *Bot name* to start with the Bot's chat and memories, or
     **Start fresh** to create a new Team Bot without them.
   * Otherwise, including when the Bot is new, it makes the copy right away and
     replies **Done. Your team copy is in the sidebar.**
3. In the team copy's chat, work through the setup cards. For each one, choose
   what the team copy gets: plugins, secrets, memories, skills, files, and
   routines. Memories you don't pick stay private; choose **Keep private** to
   share none.
4. For routines, choose whether each one moves to the team copy or stays on
   your personal Bot. Either way, a routine only runs for you, and teammates
   never see it.

Your personal Bot stays private and keeps working for you, and teammates can't
see the team copy until you publish it. If most of what a Bot knows is about
you personally, a copy won't do much for your team. Create a new Team Bot
instead.

## Set up what the Bot needs

The Bot's info pane shows a **Setup** section with cards for **Plugins**,
**Secrets**, **Skills**, and **Files**. Each card shows what you added, or
**None**. Choose a card to add to it or manage what it holds, or ask the Bot in
chat. Only the owner can change this setup, and every change reaches all
teammates.

### Plugins

Plugins you add to a Team Bot are shared: the Bot can use them in every
conversation, including Slack channels and group chats, without asking anyone
first. Each teammate still uses their own account where a plugin needs one, so
how a plugin signs in decides whose access the Bot uses:

| Plugin | Whose access the Bot uses | Required setup for teammates |
| --- | --- | --- |
| Signs in with an account (OAuth) | The person talking to the Bot | Each teammate connects their own account the first time they need it |
| Configured with a key or token | The Bot's own credential, the same for everyone | None |
| Custom MCP server, **Remote HTTPS** | The Bot's own credential, or each person's sign-in if the server uses OAuth | None, or a one-time sign-in |
| Custom MCP server, **Command** | Runs on the computer each conversation uses | None. A command that needs secrets works only in the owner's own chat |

For example, a Bot that reads Datadog alerts and files Linear tickets could
use a Datadog plugin configured with a read-only key, so nobody signs in, and
a Linear plugin that each teammate connects, so tickets are created by the
person who asked.

A **Command** server runs on whichever computer the conversation uses; see
[Where the work runs](#where-the-work-runs). Teammates can use the shell on
those computers and read the server's command and arguments, so never put a
credential in either. A Command server that needs environment variables, or
whose arguments look like a credential, runs only in your own chat. For a
custom server that needs secrets, choose **Remote HTTPS**.

Teammates can also bring their own connectors. A teammate who needs a service
the Bot doesn't have can add it as a personal plugin from their own chat, and
the Bot's shared plugins don't change. The Bot uses a person's own connectors
in their 1:1 chat, in the app or a Slack DM, without asking. In a shared
conversation, such as a Slack thread or a group chat, it asks that person
first; see [Personal connectors and approvals](#personal-connectors-and-approvals).

Your team's [connector policy](/grok-bot/teams-and-enterprises#connector-policy)
applies to Team Bots the same way it applies to other Bots.

### Secrets

Add a secret when a plugin or a script the Bot runs needs a key that has no
plugin sign-in. Each secret has a name, description, and value. Names use
uppercase letters, digits, and underscores and start with a letter, such as
`DATADOG_API_KEY`.

* Values are encrypted when stored, and the app shows only each secret's name
  and description. Teammates never see a value.
* The Bot can't see a value either. It uses a secret by name, and the value is
  replaced with `[REDACTED]` in the output of the commands it runs, the files it
  reads, and its plugin calls.
* The Bot can use every secret in any teammate's conversation, so treat a
  secret as access you are giving the whole team.
* Use scoped, read-only service-account keys instead of personal credentials.
* A Team Bot holds up to 25 secrets. Each value is at least 8 characters, so
  it can be redacted reliably, and at most 4,096 bytes.

When the Bot needs a key it doesn't have, it asks the owner with a secret
request in the owner's chat. A teammate who needs one hears that the owner
adds it.

### Skills and files

**Skills** are the team's repeatable how-tos: how to qualify a lead, how to
triage an alert, how your team writes release notes. Add them from your skill
library or write new ones. Each team skill applies in every teammate's
conversation.

**Files** give the Bot shared reference material, such as playbooks, FAQs, or
schemas. Choose the **Files** card, then choose **Upload file** or drag files
in. Supported formats are .txt, .md, .markdown, .csv, .json, .yaml, and .yml,
up to 256,000 characters per file.

Only the owner saves a team skill. When a teammate teaches the Bot a new
process in their own chat, the Bot keeps it in its notes with that person and
tells them the owner can make it a team how-to.

### Memory

A Team Bot keeps two kinds of memory:

* **Team memory** is read by every teammate's conversation. The Bot saves a
  fact there only when someone says the whole team should have it, and it
  tells you when it does.
* **Notes with each person** are private to that person. They hold that
  person's preferences and context and follow them across their app chat and
  Slack DMs with the Bot. No other teammate's conversation reads them.

To see what the Bot has saved for the team, ask it in chat. To correct or
remove something, tell it.

## Publish a Team Bot

When setup is done, the sidebar shows **You built a Bot. Now your whole team
gets a teammate.** Choose **Publish to team**, or ask the Bot to publish.

After you publish:

* Teammates find the Bot under **New chat → Team Bots**.
* Choose **Copy link** to send it to someone directly.
* You can [add it to Slack](#add-a-team-bot-to-slack).

To take the Bot away from teammates for a while, choose **Unpublish** in its
details. Teammates lose access until you publish it again. Their chats and
routines come back when you do.

To change the Bot's **Name** or **Description**, edit them in the Bot's
details. The description is up to 140 characters and is what teammates read
when they find the Bot, so write it in the Bot's own voice: “I answer
questions about our Datadog alerts.”

## Use a Team Bot

1. Choose **New chat**, then **Team Bots** at the bottom of it.
2. Find the Bot. In the desktop app, type at least three characters in
   **Search Team Bots** to search Bots you haven't added.
3. Choose **Add**, then **Start a chat**.

You can also open a link a teammate sends you. A Team Bot shows its owner's
name next to its own.

Your chat with a Team Bot is yours alone and starts fresh. The Bot knows what
is saved on it for the team and what it has learned about you, not what other
teammates said to it.

As a teammate, you can pin a Team Bot, hide it from your sidebar, and set up
your own routines with it. You can't change its setup or delete it. Ask the
owner for changes to shared plugins, secrets, skills, or files.

### Routines on a Team Bot

Routines are personal. A routine belongs to whoever set it up with the Bot, in
their own chat. It runs as them, reports in their chat, and only they can see
or change it. No routine runs for the whole team at once.

To give the whole team the output of a routine, have the routine post its
result somewhere shared, such as a Slack channel. See
[Skills, routines, and automations](/grok-bot/skills-routines-and-automations).

## Where the work runs

A Team Bot works on a Grok Bot computer, like any Bot. Which computer depends
on the conversation:

| Conversation | Computer |
| --- | --- |
| The owner's own chat | The owner's computer |
| A teammate's chat in the app, or their 1:1 Slack DM with the Bot | That teammate's own computer |
| Slack channels, group DMs, and threads | One shared computer for that Bot, separate from the owner's and every teammate's |

Files you upload in your own chat land on your computer, not the owner's.
Because Slack channel conversations share one computer, don't share anything
in a channel thread that shouldn't be visible to everyone in that channel.

## Personal connectors and approvals

In a shared conversation, such as a Slack thread or a group chat, a Team Bot
asks before it uses one of your own connectors. Plugins on the Bot don't need
this, and neither does your 1:1 chat with the Bot. The card reads **Allow** and
the plugin's name, and says which account it will use:

* **Allow once** lets the Bot use it for this reply.
* **Always allow for this Bot** remembers your answer for this Team Bot.
* **Always allow for all Team Bots** remembers your answer for every Team Bot
  on your team.
* **Skip** leaves the plugin unused for this reply.

If you haven't connected the plugin yet, the Bot asks you to sign in. In
Slack, it sends you a sign-in link.

To undo remembered answers, go to **Settings → General → Team Bots** and choose
**Clear**. Team Bots ask again the next time they need one of your connectors.

The rest of the approval model, including Auto-review, applies to Team Bots as
it does to every Bot, with one difference. In a conversation where nobody can
answer an approval card, the Bot runs without Auto-review and stays within the
permissions it was set up with, unless your team requires Auto-review. See
[Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy).

## Add a Team Bot to Slack

A published Team Bot can have its own Slack app, named after the Bot and using
its avatar. Teammates can DM it or @mention it in channels, and it answers
with the same plugins, context, and memories it has in the Grok Bot app. It
posts as itself, not as the owner.

Only the owner adds a Team Bot to Slack, and the Bot must be published first.

1. In the Bot's details, choose **Bring to your team's Slack**.
2. Choose **Connect Slack workspace** and approve Cursor in the Slack page
   that opens.
3. Pick the workspace and choose **Connect**. Pick a workspace you can install
   apps in.
4. Grok Bot creates the Slack app and installs it. The Bot sends you a welcome
   DM in Slack when it is ready.
5. Invite the Bot to the channels where it should work, for example with
   `/invite @BotName`.

Each Team Bot is its own Slack app, separate from the Cursor app in Slack.

### Slack admin approval

If your Slack workspace requires approval for new apps, the setup shows
**Awaiting admin approval**. Choose **Send request in Slack** to file the
request, then **Check approval** once an admin approves. **Cancel setup**
before you send the request, or **Cancel request** after, stops the install.

Slack admins can approve Team Bots automatically with Slack's app-approval
automations. See [How to set it up](https://cursor.com/bot/slack-auto-approve).

If Slack asks an admin to approve Cursor itself, the admin approves it, and
then you connect again.

### How the Bot behaves in Slack

* **Direct messages:** the Bot answers every message. A DM is one conversation.
* **Channels and group DMs:** the Bot answers when someone @mentions it in a
  conversation it has been added to. After that, it follows the thread, so
  later replies wake it without another mention. Each thread is its own
  conversation.
* **Other channel messages:** the Bot ignores top-level messages that don't
  mention it. Use a Slack channel listener routine to have it respond to every
  message in a channel.

### Link your Slack account

The Bot answers only people who have linked their Slack account to Cursor, so
it knows who is asking and whose accounts to use. Posts from Slack workflows
and other apps are the exception; see [Usage](#usage). Each teammate links once
under **Settings → General → Team Bots**. When someone who hasn't linked
messages the Bot, it shows them a private **Link Account** button and posts a
short reminder in the thread pointing to it.

If a linked account isn't on the Bot's Cursor team, the Bot tells that person
privately and doesn't answer.

Unlinking stops Team Bots, and Cloud Agents started from Slack, from answering
you there until you link again.

### Remove a Team Bot from Slack

In the Bot's details, choose **Remove from Slack**. This deletes the app from
the Slack workspace, and teammates can't reach the Bot from Slack until you
add it again. The Team Bot keeps working in the Grok Bot app.

## Usage

When a teammate talks to a Team Bot, in the app or in Slack, the usage counts
against that teammate's own Grok Bot allowance, not the owner's. A routine
counts against the allowance of the person who set it up. Messages in Slack
that don't come from a linked teammate, such as posts from a Slack workflow,
count against the owner.

If a teammate is out of usage, the Bot tells them in the chat or Slack thread
instead of using the owner's. See
[Plans and billing](https://cursor.com/help/grok-bot/plans).

## For admins

Team Bots follow the same team controls as every Bot, including your connector
policy, Team Rules, and Auto-review settings. See
[Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises).

### Add Team Bots for members by default

On the Grok Bot page of the
[Cursor dashboard](https://cursor.com/dashboard/bot), under **Team Bots**,
choose **Manage Team Bots**. For each Team Bot, choose who gets it in their
sidebar automatically: **All team**, **None**, or specific groups. Groups come
from the **Members & Groups** page.

Members who get a Team Bot this way see **Required by your admin. You can't
turn this off.**

Admins choose who gets a Team Bot by default. Only the Bot's owner changes its
plugins, secrets, skills, and files.

### Delete a Team Bot as an admin

In **Manage Team Bots**, choose the trash icon on the Bot's row. Type the Bot's
exact name to confirm, then choose **Delete**. The Bot is deleted for everyone
on your team, and its Slack app is removed from Slack. If the Slack app can't be
removed, a Slack workspace admin can remove it in Slack.

### Audit logs

On Enterprise, [audit logs](/grok-bot/teams-and-enterprises#audit-logs) record
Team Bot events, including when a Bot is created, published, unpublished, or
deleted, changes to its skills, and Slack account links.

## Delete a Team Bot

The owner can delete a Team Bot, and so can a team admin from
[Manage Team Bots](#delete-a-team-bot-as-an-admin). Deleting it removes the Bot
for your whole team: teammates lose it, along with their chats and routines on
it. This can't be undone.

If you may need the Bot again, choose **Unpublish** instead.

## Related pages

* [Create and manage Bots](/grok-bot/bots)
* [Message and collaborate](/grok-bot/chat-and-collaboration)
* [Use the computer and apps](/grok-bot/computer-and-apps)
* [Skills, routines, and automations](/grok-bot/skills-routines-and-automations)
* [Approvals, security, and privacy](/grok-bot/approvals-security-and-privacy)
* [Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises)
* [Troubleshooting](/grok-bot/troubleshooting)
