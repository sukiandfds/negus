import messages from '../shared/features/conversations/components/ConversationView.module.css';
import composer from '../shared/features/conversations/components/ConversationComposer.module.css';

// Presentation only: conversations and group chat share the same message and composer classes.
export function ChatSkin() {
  return <style>{`
    .feishu-app .${messages.scrollArea} { padding: 26px 24px 20px; }
    .feishu-app .${messages.conversation} { width: 100%; max-width: none; }
    .feishu-app .${messages.message} { position: relative; padding: 0 0 24px 48px; min-height: 58px; }
    .feishu-app .${messages.message}::before { content: var(--agent-initial); position: absolute; top: 0; left: 0; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--agent-color); color: white; font-size: 14px; font-weight: 500; }
    .feishu-app .${messages.user} { padding-left: 0; padding-right: 48px; text-align: right; }
    .feishu-app .${messages.user}::before { content: '我'; left: auto; right: 0; background: #338ddd; }
    .feishu-app .${messages.assistant}::before { content: ''; background-color: var(--agent-color); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='5' y='7' width='14' height='13' rx='3'/%3E%3Cpath d='M12 3v4M3 12v4M21 12v4M9 12v3M15 12v3M9 18h6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: center; }
    .feishu-app .${messages.authorName} { display: inline-block; text-align: left; color: #b7bac2; font-size: 12px; margin: 0 9px 7px 0; }
    .feishu-app .${messages.timestamp} { display: inline-block; text-align: left; font-size: 11px; color: #777b85; margin: 0 0 7px; }
    .feishu-app .${messages.user} .${messages.body} { margin-left: auto; text-align: left; padding: 9px 13px; background: #193965; border: 0; border-radius: 9px 3px 9px 9px; max-width: min(800px, 88%); }
    .feishu-app .${messages.assistant} .${messages.body} { width: fit-content; max-width: min(960px, 96%); padding: 10px 14px; border-radius: 3px 9px 9px; background: #232529; }
    .feishu-app .${messages.actionRow} { justify-content: flex-start; }
    .feishu-app .${messages.user} .${messages.actionRow} { justify-content: flex-end; }
    .feishu-app button[aria-label='带到群聊'] { display: none; }
    .feishu-app .${composer.positioner} { padding: 10px 20px 18px; background: #151619; }
    .feishu-app .${composer.composer} { width: 100%; margin: 0; border-radius: 8px; background: #191a1e; min-height: 106px; box-shadow: none; border-color: #3b3e45; }
    .feishu-app .${composer.composer}:focus-within { border-color: #5678b7; }
    .feishu-app .${composer.composer} textarea { min-height: 65px; padding: 13px 14px 8px; }
    .feishu-app .${composer.sendButton}:not(:disabled) { background: #447ded; color: white; border-radius: 6px; }
    .feishu-app .${composer.sendButton}:disabled { background: #31353c; color: #81848d; border-radius: 6px; }
    @media(max-width: 760px) {
      .feishu-app .${messages.scrollArea} { padding: 16px 12px 8px; scrollbar-gutter: auto; }
      .feishu-app .${messages.message} { padding-left: 40px; padding-bottom: 18px; }
      .feishu-app .${messages.message}::before { width: 30px; height: 30px; font-size: 12px; }
      .feishu-app .${messages.user} { padding-left: 0; padding-right: 40px; }
      .feishu-app .${messages.assistant} .${messages.body}, .feishu-app .${messages.user} .${messages.body} { max-width: calc(100% - 40px); padding: 10px 12px; overflow-wrap: anywhere; }
      .feishu-app .${messages.actionRow} button { min-width: 36px; min-height: 36px; }
      .feishu-app .${composer.positioner} { padding: 6px 10px max(8px, env(safe-area-inset-bottom)); }
      .feishu-app .${composer.composer} { min-height: 0; border-radius: 14px; }
      .feishu-app .${composer.composer} textarea { min-height: 48px; max-height: min(140px, 25dvh); padding: 11px 12px 5px; font-size: 16px; }
      .feishu-app .${composer.footer} { grid-template-columns: minmax(0, 1fr) 44px; }
      .feishu-app .${composer.sendButton} { width: 44px; height: 44px; }
    }
  `}</style>;
}
