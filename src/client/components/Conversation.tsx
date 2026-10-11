import { ArrowRight, BookMarked, RefreshCcw, Send, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Message, ProviderStatus } from "../model";
import { useMediaMatch } from "../useMediaMatch";
import { TrackingNotice } from "./TrackingNotice";

const PROMPTS = [
  "Help me understand a difficult idea",
  "Quiz me on something I studied",
  "Work through a problem with me",
] as const;

type ConversationProps = {
  readonly messages: readonly Message[];
  readonly provider: ProviderStatus;
  readonly draft: string;
  readonly submitting: boolean;
  readonly showProgress: boolean;
  readonly error: string | null;
  readonly onDraft: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onRetry: () => void;
  readonly onKnowledge: () => void;
  readonly recovery: ReactNode;
};

export function Conversation(props: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaMatch("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [reducedMotion]);

  return (
    <>
      <div className="conversation-scroll">
        <div className="conversation">
          {props.recovery}
          {props.provider.mode === "synthetic" ? (
            <div className="notice notice-demo">
              <Sparkles className="icon" aria-hidden="true" />
              <span>
                <strong>Synthetic demo mode.</strong> Responses demonstrate the tutor workflow and
                are explicitly marked; they are not from a configured model.
              </span>
            </div>
          ) : null}
          {props.error === null ? null : (
            <div
              className="notice notice-error"
              role="alert"
              style={{ marginBlockStart: "var(--space-4)" }}
            >
              <span>{props.error}</span>
              <button className="button button-secondary" type="button" onClick={props.onRetry}>
                <RefreshCcw className="icon" />
                Refresh
              </button>
            </div>
          )}
          {props.messages.length === 0 ? (
            <EmptyState onPrompt={props.onDraft} />
          ) : (
            <MessageList messages={props.messages} />
          )}
          {props.showProgress ? <TutorProgress /> : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer-wrap">
        <div className="composer">
          <div className="composer-box">
            <label>
              <span className="sr-only">Ask your tutor</span>
              <textarea
                value={props.draft}
                onChange={(event) => props.onDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    !props.submitting &&
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  )
                    props.onSubmit();
                }}
                placeholder="Ask a question, test an idea, or describe where you are stuck…"
              />
            </label>
            <button
              className="icon-button button-primary"
              type="button"
              onClick={props.onSubmit}
              disabled={props.submitting || props.draft.trim().length === 0}
              aria-label={props.submitting ? "Sending message" : "Send message"}
            >
              {props.submitting ? <span className="spinner" /> : <Send className="icon" />}
            </button>
          </div>
          <div className="cluster" style={{ justifyContent: "space-between" }}>
            <p className="composer-hint">
              Ctrl/⌘ + Enter to send · Tutair can be wrong; inspect its evidence.
            </p>
            <button
              className="button button-secondary mobile-only"
              type="button"
              onClick={props.onKnowledge}
            >
              <BookMarked className="icon" />
              Overview
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyState({ onPrompt }: { readonly onPrompt: (prompt: string) => void }) {
  return (
    <section className="empty-state">
      <p className="eyebrow">Your current goal</p>
      <h2>What would you like to understand today?</h2>
      <p className="muted">
        Start with the idea, question, or problem in front of you. Tutair will ask, explain, and
        show what evidence shaped its view.
      </p>
      <div className="prompt-grid">
        {PROMPTS.map((prompt) => (
          <button
            className="prompt-button"
            type="button"
            key={prompt}
            onClick={() => onPrompt(prompt)}
          >
            <span>{prompt}</span>
            <ArrowRight className="icon" />
          </button>
        ))}
      </div>
    </section>
  );
}

function MessageList({ messages }: { readonly messages: readonly Message[] }) {
  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => (
        <div className="message-with-tracking" key={message.id}>
          <article
            className={`message ${message.role === "user" ? "message-user" : "message-tutor"}`}
          >
            <div className="message-meta">
              <span>{message.role === "user" ? "You" : "Tutair"}</span>
              {message.status === "sending" ? <span>Thinking…</span> : null}
              {message.status === "failed" ? <span>Not sent</span> : null}
            </div>
            <p>{message.content}</p>
          </article>
          {message.role === "assistant" && message.tracking !== undefined ? (
            <TrackingNotice status={message.tracking} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TutorProgress() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  return (
    <section className="tutor-progress">
      <span className="spinner tutor-progress-spinner" aria-hidden="true" />
      <div className="tutor-progress-copy" role="status" aria-atomic="true">
        <strong>Preparing your answer</strong>
        <span>Tutair reviews several learning signals, so this can take a few minutes.</span>
      </div>
      <span className="tutor-progress-elapsed" aria-hidden="true">
        Elapsed {minutes}:{seconds}
      </span>
    </section>
  );
}
