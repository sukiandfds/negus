# Grok Bot 群聊回应规则核实

核实日期：2026-10-07（Asia/Shanghai）。本轮只读调研，未修改Negus回应规则。

## 官方文档核实成功（后续重试）

通过macOS已配置的本地HTTP代理显式请求，[Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration)返回HTTP 200，页面标注最后更新为2026-09-21。官方“Direct a message”原文：

> Write normally to let the participating Bots decide who should respond.
> Type @ and select a Bot when one teammate owns the request.
> Mention multiple Bots when the request genuinely needs each of them.
> Use @everyone sparingly for a group-wide update.

据此，正常发言由参与的Bot判断谁回应；@指定负责Bot，也可点名多个Bot或@everyone。官方未在该段解释选择算法，也未保证每条消息一定获答；不能说“不@无人回复”，也不能说“不@全部必答”。此官方说明优先于下面的社区摘要，修正此前仅基于社区材料的结论。

超时诊断：命令行curl没有使用macOS系统代理，直连docs.x.ai的TCP 443连接6秒内无法建立，尚未进入TLS或HTTP；显式使用系统已配置的127.0.0.1:7892代理后，文档与llms.txt均返回200。未更改机器网络设置。产品页x.ai/bot经代理返回Cloudflare 403，属于另一访问结果，不能与文档连接超时混为一谈。

## 此前直接读取的社区证据

1. 社区直播整理仓库`unicodef1wn/grokbot-field-notes`，固定提交`02780c04ef5f412b28573bce6f82afd15d195d1f`：
   - [reference/PRODUCT.md 第100行](https://github.com/unicodef1wn/grokbot-field-notes/blob/02780c04ef5f412b28573bce6f82afd15d195d1f/reference/PRODUCT.md#L100)：原文“Group chats work but every bot answers every message.”即群聊里每个Bot回答每条消息。
   - [notes/day-1-notes.md 第23行](https://github.com/unicodef1wn/grokbot-field-notes/blob/02780c04ef5f412b28573bce6f82afd15d195d1f/notes/day-1-notes.md#L23)：多Bot群聊会抢着说话，成本增加，建议多数工作使用单聊。
   - [reference/ECONOMICS.md](https://github.com/unicodef1wn/grokbot-field-notes/blob/02780c04ef5f412b28573bce6f82afd15d195d1f/reference/ECONOMICS.md)：群聊Bot“eager”“love to talk”“speak over each other”。
   - README明确说明这些文件是作者对2026年9月三天官方团队直播的整理；各文件属于同一来源，不计作独立实测。
2. 较新的第三方客户端`ScriptedAlchemy/grok-bot-cli`，提交`43499fa27f36807f6ac93b56365b3cae5200bc1e`（2026-10-05 UTC）：
   - [src/core/gateway.js](https://github.com/ScriptedAlchemy/grok-bot-cli/blob/43499fa27f36807f6ac93b56365b3cae5200bc1e/src/core/gateway.js#L436)将群ID与普通消息直接传给`sendPrompt`，客户端没有“不含@则拒绝触发”的判断。
   - 此代码仅支持群消息可作为prompt投递，不能证明官方后端一定唤醒全部成员，也不能替代真实响应验收。

## 此前结论与未确认项（已由上方官方证据更新）

公开社区资料明确记录的行为是“群内Bot回应消息”，而非Negus当前的“不@就无人回应”。但这些是2026年9月的二手记录，不是当前版本官方契约或本轮登录实测。

本轮访问`https://docs.x.ai/grok-bot/chat-and-collaboration`、`https://docs.x.ai/grok-bot/overview`、`https://docs.x.ai/llms.txt`及`https://x.ai/bot`均超时；不能由访问失败推断页面不存在。

当前版本“不@时是否所有成员必答”、是否可配置默认接话者、@能否抑制其他成员，仍未实测确认。不将第三方客户端或仿品的行为写成官方产品事实。
