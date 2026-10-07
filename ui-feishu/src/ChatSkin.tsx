import messages from '../../web-ui/src/features/conversations/components/ConversationView.module.css';
import composer from '../../web-ui/src/features/conversations/components/ConversationComposer.module.css';
import groupComposer from '../../web-ui/src/features/group-chat/components/GroupComposer.module.css';
import group from '../../web-ui/src/features/group-chat/components/MessageTimeline.module.css';

// Presentation only: the original components retain all message and execution behavior.
export function ChatSkin() {
  return <style>{`
    .feishu-app :is(.${messages.scrollArea}, .${group.timeline}) { padding: 26px 24px 20px; }
    .feishu-app .${messages.conversation} { width: 100%; max-width: none; }
    .feishu-app .${messages.message}, .feishu-app .${group.message} { position: relative; padding: 0 0 24px 48px; min-height: 58px; }
    .feishu-app .${messages.message}::before, .feishu-app .${group.messageAvatar} { content: var(--agent-initial); position: absolute; top: 0; left: 0; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--agent-color); color: white; font-size: 14px; font-weight: 500; }
    .feishu-app .${messages.user} { padding-left: 0; padding-right: 48px; text-align: right; }
    .feishu-app .${messages.user}::before { content: '我'; left: auto; right: 0; background: #338ddd; }
    .feishu-app .${messages.assistant}::before, .feishu-app .${group.agentMessageAvatar} { content: ''; background-color: var(--agent-color); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='5' y='7' width='14' height='13' rx='3'/%3E%3Cpath d='M12 3v4M3 12v4M21 12v4M9 12v3M15 12v3M9 18h6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: center; }
    .feishu-app .${messages.authorName} { display: inline-block; text-align: left; color: #b7bac2; font-size: 12px; margin: 0 9px 7px 0; }
    .feishu-app .${messages.timestamp} { display: inline-block; text-align: left; font-size: 11px; color: #777b85; margin: 0 0 7px; }
    .feishu-app .${messages.user} .${messages.body}, .feishu-app .${group.ownMessageBubble} { margin-left: auto; text-align: left; padding: 9px 13px; background: #193965; border: 0; border-radius: 9px 3px 9px 9px; max-width: min(800px, 88%); }
    .feishu-app .${messages.assistant} .${messages.body}, .feishu-app .${group.messageBubble}:not(.${group.ownMessageBubble}) { width: fit-content; max-width: min(960px, 96%); padding: 10px 14px; border-radius: 3px 9px 9px; background: #232529; }
    .feishu-app .${messages.actionRow} { justify-content: flex-start; }
    .feishu-app .${messages.user} .${messages.actionRow} { justify-content: flex-end; }
    .feishu-app button[aria-label='带到群聊'] { display: none; }
    .feishu-app .${group.timeline} { scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: #3b3d3f transparent; }
    .feishu-app .${group.roster} { padding: 8px 24px; }
    .feishu-app .${group.message} { display: block; margin: 0; }
    .feishu-app .${group.messageAvatar} { padding: 0; border: 0; background-color: #4b87b4; }
    .feishu-app .${group.agentMessageAvatar} { font-size: 0; }
    .feishu-app .${group.messageContent} { width: 100%; max-width: none; padding: 0; }
    .feishu-app .${group.messageMeta} { margin-bottom: 7px; gap: 9px; }
    .feishu-app .${group.messageMeta} strong { color: #b7bac2; font-size: 12px; font-weight: 400; }
    .feishu-app .${group.messageMeta} span { color: #777b85; font-size: 11px; }
    .feishu-app .${group.copyButton} { margin-left: 0; }
    .feishu-app .${group.messageBubble} { border: 0; }
    .feishu-app .${group.messageFocused} .${group.messageBubble} { outline: 1px solid var(--color-accent); }
    .feishu-app .${group.messageBubble} > p, .feishu-app .${group.markdown} { color: var(--color-text); font-size: 15px; line-height: 1.68; }
    .feishu-app .${group.markdown} a { color: var(--color-accent); }
    .feishu-app .${group.message}:has(.${group.ownMessageBubble}) { padding-left: 0; padding-right: 48px; }
    .feishu-app .${group.message}:has(.${group.ownMessageBubble}) > .${group.messageAvatar} { left: auto; right: 0; background: #338ddd; }
    .feishu-app .${group.message}:has(.${group.ownMessageBubble}) .${group.messageMeta} { justify-content: flex-end; }
    .feishu-app :is(.${composer.positioner}, .${groupComposer.composerArea}) { padding: 10px 20px 18px; background: #151619; }
    .feishu-app :is(.${composer.composer}, .${groupComposer.composer}) { width: 100%; margin: 0; border-radius: 8px; background: #191a1e; min-height: 106px; box-shadow: none; border-color: #3b3e45; }
    .feishu-app :is(.${composer.composer}, .${groupComposer.composer}):focus-within { border-color: #5678b7; }
    .feishu-app :is(.${composer.composer}, .${groupComposer.composer}) textarea { min-height: 65px; padding: 13px 14px 8px; }
    .feishu-app :is(.${composer.sendButton}, .${groupComposer.sendButton}):not(:disabled) { background: #447ded; color: white; border-radius: 6px; }
    .feishu-app :is(.${composer.sendButton}, .${groupComposer.sendButton}):disabled { background: #31353c; color: #81848d; border-radius: 6px; }
    .feishu-app .${groupComposer.personnelMenu} { left: 20px; right: 20px; }
    @media(max-width: 760px) { .feishu-app :is(.${messages.scrollArea}, .${group.timeline}) { padding: 20px 12px; } .feishu-app .${messages.message}, .feishu-app .${group.message} { padding-left: 42px; } .feishu-app .${messages.user}, .feishu-app .${group.message}:has(.${group.ownMessageBubble}) { padding-left: 0; padding-right: 42px; } .feishu-app .${messages.assistant} .${messages.body}, .feishu-app .${messages.user} .${messages.body}, .feishu-app .${group.messageBubble}:not(.${group.ownMessageBubble}), .feishu-app .${group.ownMessageBubble} { max-width: 100%; } .feishu-app :is(.${composer.positioner}, .${groupComposer.composerArea}) { padding: 8px 10px 10px; } .feishu-app .${group.roster} { padding: 8px 12px; } .feishu-app .${groupComposer.personnelMenu} { left: 10px; right: 10px; } }
  `}</style>;
}
