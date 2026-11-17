#### Help

# Troubleshooting

Start with the least destructive step. A Bot's cloud work can continue even
when the desktop or mobile app is disconnected.

## Sign-in does not complete

1. Keep Grok Bot open while authentication runs in your browser.
2. Confirm the browser shows a successful Cursor sign-in.
3. Return to the app manually if it does not regain focus.
4. Try **Get started** or **Sign In with Cursor** again.
5. Confirm that your account has Grok Bot access.

If your organization uses SSO, complete the organization login rather than
signing in with a different personal account.

An error about Legacy Privacy Mode means the account is using a data mode that
does not permit Grok Bot's required storage. Update the Cursor account data
setting or contact your organization administrator.

## The computer is still setting up

Initial setup and an image update can take several minutes. Keep the app open
until **Starting your computer** or **Updating your computer** completes.

If progress is still changing, wait. If it fails or stops changing:

1. Retry from the error state.
2. Restart Grok Bot.
3. Check for a Grok Bot app update.
4. If the computer remains unreachable, open **Settings → Updates** and choose
   **Update** under **Grok Bot's Computer**.

## The computer cannot be reached

Your Bot profiles and saved conversations are not necessarily lost when the
computer is temporarily unreachable.

Recover in this order:

1. Choose **Retry** or reopen the conversation.
2. Restart the Grok Bot app.
3. Choose **Recover computer** from the unreachable-computer state when offered
   (the confirmation dialog calls it **Recover Grok Bot's Computer**).
4. If recovery is not available, open **Settings → Updates** and choose
   **Update** under **Grok Bot's Computer**. On iPhone and Android, the same
   controls are **Update Computer** and **Reset Computer** under **Settings →
   Bot → Bot Computer**.
5. Wait for the replacement computer to become available.
6. Use **Reset** only if recovery and update fail and you accept losing recent
   unsynced work.

**Recover computer** and **Update** preserve durable files and logins.
**Reset** restores the last saved snapshot and can lose recent or unsynced
work.

## A Bot appears stuck

* Check the status shown in the sidebar and conversation.
* Open the computer to see whether the Bot is waiting on a page.
* Look for a question, approval, login, CAPTCHA, or secret request.
* Send a short redirect if the current approach is wrong.
* Send a direct “Stop now” message if the work should end.

A computer-use task already active on that Bot's screen may need to finish or
be redirected before another one can start.

If usage is exhausted or an on-demand spending limit is reached, review usage
and billing from the account access page or **Usage & Billing** when that
section is available.

## A website keeps asking for login

1. Take over the computer and sign in yourself.
2. Complete two-factor authentication or CAPTCHA.
3. Confirm the signed-in page has loaded before returning control.
4. Tell the Bot to continue from the current page.

Do not paste a password or verification code into ordinary chat. Some sites
expire sessions or require verification for each sensitive action; this cannot
always be avoided.

## A plugin will not install or authenticate

1. Open **Marketplace** from the sidebar, choose **Your plugins**, and confirm
   the plugin is listed under **Installed**.
2. Reopen its detail page and choose the authentication action.
3. Complete authorization with the intended account in the browser.
4. Return to Grok Bot and retry the task.
5. Check whether the connector requires an organization-provided variable or
   administrator configuration.

If authentication was revoked in the source service, remove and reconnect the
plugin.

## An attachment cannot be read

Check that:

* The file is no larger than 25 MB, or 200 MB for video
* No more than six attachments were selected at once on desktop
* The file is not encrypted or password-protected
* The upload finished before sending
* The file type is supported

Try exporting an unusual format as PDF, CSV, plain text, or an image. Do not
remove document protection if the resulting file would violate your data
policy.

## A routine did not run

Open the routine and verify:

* It is enabled
* Its schedule and time zone are correct
* The owning Bot still exists
* Required plugins remain authenticated
* The computer can reach the source system
* Usage or account access has not been paused

Inspect recent run history for a failure. Use **Test run** only with safe input;
testing can perform real external actions.

For an event-triggered routine, confirm the source channel, repository, and
matching rule are still valid.

## An approval is blocked

Read the proposed target and arguments. If the card is no longer actionable:

1. Reject or cancel it if that control is available
2. Send the Bot a replacement instruction
3. Ask it to regenerate the action with the corrected scope

If an action keeps requiring approval, check **Settings → General → Bot →
Auto-review** for a matching **Ask first** rule, including team rules your
admin requires. **Ask first** rules take precedence over **Allow
automatically** rules.

## Local computer work is refused

Cloud-computer work and local-computer work use different permissions. Open
**Settings → General → Bot → Execution on Local Computer** (or the computer's
row under **Settings → Computer → Computers**) and review the policy.

Keep local access disabled unless the task specifically requires files or
commands on the computer in front of you.

## Update Grok Bot

The Grok Bot app and the Agent Computer have separate updates.

* To update the app, open **Settings → Updates → Check for Updates**. If an
  update is ready, choose **Restart to Update**.
* To rebuild the cloud computer, choose **Update** under **Grok Bot's
  Computer** in the same section.

Updating the desktop app does not reset the cloud computer.

## Before contacting support

Collect:

* Grok Bot version
* Operating system and version
* The exact error message
* The Bot or routine name
* The approximate time and time zone
* The full request ID or conversation ID if one is shown
* Whether retry, app restart, or updating Grok Bot's computer changed the
  result

Do not include passwords, one-time codes, private keys, or secret values.
