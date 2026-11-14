import { useEffect, useMemo, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { UserInputRequest } from "../../execution/model/types";
import styles from "./UserInputDialog.module.css";

const otherValue = "__negus_other__";

export function UserInputDialog({ request, busy, error, onSubmit }: {
  request: UserInputRequest | null;
  busy: boolean;
  error: string;
  onSubmit: (answers: Record<string, { answers: string[] }>) => Promise<boolean>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
    setCustomValues({});
  }, [request?.requestId]);

  const answers = useMemo(() => {
    const result: Record<string, { answers: string[] }> = {};
    for (const question of request?.questions || []) {
      const value = values[question.id] === otherValue ? customValues[question.id] : values[question.id];
      const answer = String(value || "").trim();
      if (answer) result[question.id] = { answers: [answer] };
    }
    return result;
  }, [customValues, request?.questions, values]);

  if (!request) return null;
  const complete = request.questions.length > 0
    && request.questions.every((question) => answers[question.id]?.answers.length);

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="user-input-title">
        <header className={styles.header}>
          <span className={styles.icon} aria-hidden="true"><MessageCircleQuestion /></span>
          <div>
            <h2 id="user-input-title">Codex 需要您的选择</h2>
            <p>回答后，当前任务会继续执行</p>
          </div>
        </header>

        <form className={styles.form} onSubmit={(event) => {
          event.preventDefault();
          if (complete && !busy) void onSubmit(answers);
        }}>
          <div className={styles.questions}>
            {request.questions.map((question, questionIndex) => (
              <fieldset className={styles.question} key={question.id}>
                <legend>
                  {request.questions.length > 1 ? <span>{questionIndex + 1}</span> : null}
                  {question.header || "请选择"}
                </legend>
                <p>{question.question}</p>
                {question.options?.length ? (
                  <div className={styles.options}>
                    {question.options.map((option) => (
                      <label className={styles.option} key={option.label}>
                        <input
                          type="radio"
                          name={question.id}
                          value={option.label}
                          checked={values[question.id] === option.label}
                          onChange={() => setValues((current) => ({ ...current, [question.id]: option.label }))}
                        />
                        <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
                      </label>
                    ))}
                    {question.isOther ? (
                      <label className={`${styles.option} ${styles.other}`}>
                        <input
                          type="radio"
                          name={question.id}
                          value={otherValue}
                          checked={values[question.id] === otherValue}
                          onChange={() => setValues((current) => ({ ...current, [question.id]: otherValue }))}
                        />
                        <span>
                          <strong>其他</strong>
                          <input
                            className={styles.otherInput}
                            type={question.isSecret ? "password" : "text"}
                            value={customValues[question.id] || ""}
                            autoComplete="off"
                            placeholder="请输入您的回答"
                            onFocus={() => setValues((current) => ({ ...current, [question.id]: otherValue }))}
                            onChange={(event) => setCustomValues((current) => ({ ...current, [question.id]: event.target.value }))}
                          />
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : (
                  <input
                    className={styles.textInput}
                    type={question.isSecret ? "password" : "text"}
                    value={values[question.id] || ""}
                    autoComplete="off"
                    placeholder="请输入您的回答"
                    onChange={(event) => setValues((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                )}
              </fieldset>
            ))}
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <footer className={styles.footer}>
            <button type="submit" disabled={!complete || busy}>{busy ? "正在提交" : "提交并继续"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
