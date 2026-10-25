import styles from "./QuoteDraft.module.css";

export interface MessageQuote { id: string; authorName: string; text: string }

export function QuoteDraft({ quote, onClear }: { quote?: MessageQuote | null; onClear?: () => void }) {
  return quote ? <div className={styles.quoteDraft}>
    <span>回复 {quote.authorName}：{quote.text}</span>
    <button type="button" aria-label="取消引用" onClick={onClear}>取消</button>
  </div> : null;
}
