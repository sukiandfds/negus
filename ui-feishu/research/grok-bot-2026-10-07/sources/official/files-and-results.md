#### Work with Grok Bot

# Files and results

Attach source material to a request and ask the Bot to return work in a form you
can inspect, edit, and hand off.

## Attach files

Use the attachment control or drag files into the composer. You can also paste
images and links.

Common supported inputs include:

* Images, audio, and video
* PDF and plain-text documents
* Word, Excel, and PowerPoint files
* CSV, JSON, YAML, and source-code files
* HTML and email files
* Jupyter notebooks

The desktop composer accepts up to six attachments at a time. Documents,
images, and audio can be up to 25 MB each; videos can be up to 200 MB. Large,
encrypted, damaged, or unusual files may not be readable.

On iPhone, you can also share a photo, file, link, or text from another app
into Grok Bot. Use the system share sheet, choose **Grok Bot**, pick a chat,
and choose **Attach**. The item is added to that conversation's composer. On
Android, the share sheet currently accepts text. See
[Grok Bot for Mobile](/grok-bot/mobile).

Tell the Bot what each attachment is and how it should use it:

> The PDF is the signed policy. The spreadsheet is this month's transactions.
> Reconcile the spreadsheet against the policy, cite the relevant policy
> section for every exception, and return a new spreadsheet plus a short
> summary. Do not modify the originals.

## Share a link

Paste a link when the Bot can access the page from its computer or a connector.
If the page is private, sign in through the computer or install the relevant
connector.

Links in messages and results open in your system browser; hovering over a
link card shows a preview first. Always check the destination before entering
credentials or approving an external action.

## Ask for a reviewable result

Specify the artifact and its acceptance criteria:

* A document with headings and source links
* A spreadsheet with defined columns and formulas
* A slide deck with speaker notes
* A folder containing screenshots and logs
* A draft message that has not been sent
* A short recommendation followed by the underlying evidence

For consequential work, ask the Bot to separate:

1. Facts found in source systems
2. Assumptions or inferences
3. Actions already completed
4. Actions waiting for approval
5. Unresolved questions

## Preview generated work

Files, images, links, and tool results appear as cards in the conversation.
Open a card to preview supported formats. You can then save the file, open the
source link, or continue the conversation with feedback.

Ask the Bot to revise the existing artifact instead of making disconnected
copies:

> Update the report you just created. Add source links to the first two claims
> and replace the final table with a CSV attachment.

## Results from Cloud Agents

A Bot can hand coding work to a
[Cloud Agent](/grok-bot/teams-and-enterprises#cloud-agents). When the Cloud
Agent finishes, the Bot copies the images, videos, and other files cited in the
Cloud Agent's final report to its computer and attaches them to its reply.
In the desktop app, the Cloud Agent's card in the conversation shows the same
files; open an image or video to view it full screen.

## Preserve evidence

A strong result should be independently reviewable. Depending on the task, ask
for:

* Direct source links
* Screenshots with the relevant state visible
* Timestamps and time zones
* Input and output file names
* A concise action log
* An explicit list of anything the Bot could not verify

Do not rely on a screenshot alone for rapidly changing data. Keep a link or
export from the source system when possible.

## Shared computer files

Bots can read files other Bots save in `/workspace`. Use project folders and
descriptive names to make handoffs reliable.

The shared workspace is useful for intermediate material, but the conversation
should still contain the final result or a clear link to it. See
[Use the computer and apps](/grok-bot/computer-and-apps) for persistence and recovery
details.
