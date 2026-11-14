#### Manage and protect

# Manage Grok Bot computers

Each member of your team gets one hosted computer where every Bot they run does
its work. The **Bot Computers** section of the
[Grok Bot page of the Cursor dashboard](https://cursor.com/dashboard/bot) gives
organization admins two ways to manage those computers: run a recreate or
terminate across many members at once with **Manage Bot Computers**, or turn on
[automatic termination](#terminate-inactive-computers-automatically) for
computers that go 30 days without use. For the rest of the admin controls, see
[Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises).

**Manage Bot Computers is Enterprise only**, and it appears only for organization
admins. Team admin rights are not enough, because one computer spans every team
the member belongs to. Members never see this control. Team admins can still
[restart the team's computers after a settings change](#restart-after-a-settings-change).

## Recreate or terminate

Both actions keep the member's durable disk, so their synced Bots, files, and
logins come back on the next computer. Both remove apps and packages members
installed themselves. Anything your Team Setup manifests install comes back on
the new computer.

| Action | What happens | When to use it |
| --- | --- | --- |
| **Recreate** | Builds a replacement computer on the latest image and runs [Team Setup](/grok-bot/teams-and-enterprises#team-setup). The current computer stays available until the replacement is ready, then Grok Bot switches over. A Bot that is mid-turn pauses at a safe point and resumes on the new computer. If it cannot pause in time, that member's recreate is not started and shows as failed. | Roll out a new image or an updated Team Setup manifest to many members at once. [Network policy](/grok-bot/security#network-policy) changes reach computers without a recreate. |
| **Terminate** | Deletes the member's computer, running or hibernated. Running work stops. The computer does not restart on its own; the member's next message starts a fresh one on the same durable disk. | End a member's current work, or clear a computer that is stuck. Terminating does not remove access; see the [FAQ](#faq). |

## Run an operation

### Open Manage Bot Computers

Go to [Grok Bot in the Cursor dashboard](https://cursor.com/dashboard/bot).
Under **Bot Computers**, find **Manage Bot Computers** and select **Manage**.

### Select members

Search by name or email, then check the members you want. **Select all** picks
everyone in the current results.

### Choose an action

Open **Manage selected** and pick **Recreate VMs** or **Terminate VMs**. A
confirmation screen restates the action and the number of members it affects.
The same menu also offers **Delete VMs and Data**, which removes the computer
and its durable data. Use it only when you want the member to start from empty.

### Confirm

Select **Recreate VMs** or **Terminate VMs** to start. Members without a
computer are skipped.

### Watch the results

A progress card shows queued, running, complete, skipped, and failed counts,
and each member's row shows its status. When the operation finishes, select
**Done** to clear the results and start another.

## How an operation runs

* **It runs on Cursor's side.** Closing the dialog or the browser does not stop
  it. Reopen **Manage** in the same browser to pick the progress back up.
* **Large operations take a while.** Members are processed in batches, and each
  recreate waits for the replacement computer to be ready before it counts as
  complete.
* **One operation per team at a time.** The action buttons stay disabled until
  you select **Done** on the finished results. The limit covers every admin: a
  start made while another operation for the team is still running shows
  **Not Started** and changes nothing. Select **Done**, wait for the running
  operation to finish, then start again.
* **Retry Start never duplicates work.** Use it when the dashboard cannot
  confirm the operation started.
* **A refused start says why.** A start that cannot run, for example because
  none of the selected members are still on the team, shows **Not Started**
  with the reason and changes nothing.

## Skipped and failed members

A finished operation lists a result for every member you selected.

| Result | Meaning | What to do |
| --- | --- | --- |
| **Skipped**, No VM | The member had no running or hibernated computer. | Nothing. |
| **Skipped**, Action could not be completed | The member left the team or has never signed in, or their account changed while the operation was queued. | Nothing. |
| **Failed**, Another recreation is in progress | The member's computer is already being recreated, by an update or another admin. | Wait for it to finish, then run again for this member. |
| **Failed**, VM scan incomplete | Cursor could not confirm the state of the member's computer, so it made no change. | Run the operation again in a few minutes. |
| **Failed**, Action could not be completed | The recreate or terminate did not finish. For a recreate, a Bot on the member's computer may have been unable to pause in time, and the member keeps their current computer. | Run the operation again for the affected members, once their Bots are idle if you can. If it fails twice, [contact support](https://cursor.com/help/grok-bot/get-help) with the member's email and the time of the operation. |

## Restart after a settings change

After some changes to team settings, the Grok Bot page shows **Restart VMs to
apply changed settings** at the top. Select **Restart all VMs**, then
**Recreate VMs**, to recreate the computer of every member of the team with the
current team settings. The restart runs like any other recreate operation, with
the same progress card and results, and the notice clears once it starts.

Team admins on an Enterprise team can run this restart, not only organization
admins. It only recreates; **Terminate VMs** and **Delete VMs and Data** stay
with organization admins under **Manage Bot Computers**.

## Terminate inactive computers automatically

A hibernated computer stays around until someone terminates it, even when the
member has moved on or stopped using Grok Bot. **Terminate Inactive
Computers**, just above **Manage Bot Computers** in the same section, does that
cleanup for you. When a member's computer goes 30 days without use, Cursor
terminates it. Using Grok Bot again restarts the count.

The setting is off by default. Turning it on opens a confirmation. Two things
to know before you select **Turn On**:

* **Computers already past 30 days are included.** There is no grace period.
  Cursor checks hibernated computers on a rolling schedule, so termination
  lands in the days after the 30-day mark rather than at the exact moment.
* **Members lose nothing and do nothing.** An automatic terminate works like a
  manual one. The durable disk stays, and the member's next message starts a
  fresh computer with their Bots, files, and logins in place. Apps and packages
  they installed themselves are removed, and Team Setup runs again.

Turning the setting off stops further terminations. One computer spans every
team a member belongs to, so the setting applies to a member's computer if any
of their Enterprise teams has it on.

## What members see

During a recreate, the desktop app shows **Updating Grok Bot's Computer** until
the switch completes. Bots that were working pause at a safe point and continue
on the new computer. Sign-in sessions inside the computer can drop when it is
recreated, so members sign in to company tools again under your identity
provider's policies.

After a terminate, manual or automatic, the member's next message starts a
fresh computer on their durable disk. The reconnect can take a few minutes.
Bots, files, and logins that had synced come back; a turn that was running is
lost.

## FAQ

### Can I recreate a member's computer from a different team?

Yes. Select the member from any team they belong to. One computer serves every
team the member is in, so recreating or terminating it from one team affects
the same computer everywhere.

### Does terminating stop a member from using Grok Bot?

No. Terminating a computer, by hand or automatically, ends the member's current
work. Their next message starts a fresh computer on the same durable disk, with
their Bots, files, and logins. To remove access, remove the member from the
team or turn off their access with **Manage Group Access**, and revoke their
sessions in your identity provider. See
[Enable Grok Bot](/grok-bot/teams-and-enterprises#enable-grok-bot).

### Can automatic termination interrupt a Bot that is still working?

No. The 30 days count from when the computer went to sleep after its last use.
A computer that is awake, because a Bot is working or the member is using Grok
Bot, is never terminated by this setting.

## Related pages

* [Grok Bot for teams and enterprises](/grok-bot/teams-and-enterprises)
* [Grok Bot security](/grok-bot/security)
* [Connect to private networks](/grok-bot/private-networks)
* [Update, recover, or reset the computer](/grok-bot/computer-and-apps#update-recover-or-reset-the-computer)
* [Grok Bot computer](https://cursor.com/help/grok-bot/computer-recovery)
