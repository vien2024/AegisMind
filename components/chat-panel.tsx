"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icons";

export function ChatPanel({ taskId }: { taskId: number }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: `/api/tasks/${taskId}/chat` }), [taskId]);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({ transport });

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[30rem] flex-col">
      <div className="scroll flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-[12px] text-faint">
            Ask the main agent about this task. It can read both graphs and send new intents on your behalf.
            A live model is required. It can run shell commands and Python scripts from the workspace without
            per-run approval; these executions are time-limited but not sandboxed.
          </p>
        )}
        {messages.map((message: UIMessage) => (
          <div
            key={message.id}
            className="rounded-lg border px-3 py-2 text-[12px]"
            style={
              message.role === "user"
                ? { borderColor: "var(--border)", background: "var(--hover)" }
                : { borderColor: "var(--border)", background: "var(--subtle)" }
            }
          >
            <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">
              {message.role === "user" ? "operator" : "main agent"}
            </div>
            <div className="space-y-1">
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <p key={index} className="whitespace-pre-wrap text-ink">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                  const name = part.type === "dynamic-tool" ? "tool" : part.type.slice(5);
                  return (
                    <p key={index} className="mono flex items-center gap-1 text-[11px] text-link">
                      <Icon name="wrench" className="h-3 w-3" />
                      {name}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {error && <p className="text-[11px] text-red-600">Error: {error.message}</p>}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || busy) return;
          void sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about coverage, findings, or request a new direction…"
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
