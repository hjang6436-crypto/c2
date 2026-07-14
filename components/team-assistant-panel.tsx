"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CarryMateLogo } from "@/components/carrymate-logo";
import {
  buildDemoAssistantResponse,
  type TeamAssistantContext,
  type TeamAssistantMessage,
  type TeamAssistantSuggestedAction,
} from "@/lib/carrymate/assistant-context";
import type { TabId } from "@/types/carrymate";

type ChatBubble = TeamAssistantMessage & {
  id: string;
  suggestedActions?: TeamAssistantSuggestedAction[];
};

type TeamAssistantPanelProps = {
  open: boolean;
  teamId: string | null;
  teamName: string;
  accessToken: string | null;
  isDemo: boolean;
  context: TeamAssistantContext;
  onClose: () => void;
  onNavigate: (tab: TabId) => void;
  onOpenMeeting: (meetingId: string | null) => void;
};

const RECOMMENDED_QUESTIONS = [
  "오늘 해야 할 일이 뭐야?",
  "연체된 업무가 있어?",
  "최근 회의에서 결정된 내용을 알려줘.",
  "참고자료를 찾아줘.",
];

const MAX_HISTORY_MESSAGES = 12;
const MAX_QUESTION_LENGTH = 500;

function getStorageKey(teamId: string | null, isDemo: boolean) {
  return `carrymate:assistant:${isDemo ? "demo" : teamId ?? "unknown"}`;
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trimMessages(messages: ChatBubble[]) {
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseSuggestedActions(value: unknown): TeamAssistantSuggestedAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const type = record.type;
      const label = safeString(record.label).trim();
      const targetId = record.targetId;

      if (
        type !== "open_tasks" &&
        type !== "open_schedule" &&
        type !== "open_meeting" &&
        type !== "open_files" &&
        type !== "none"
      ) {
        return null;
      }

      if (!label) {
        return null;
      }

      return {
        type,
        label,
        targetId: typeof targetId === "string" && targetId.trim() ? targetId.trim() : null,
      };
    })
    .filter((item): item is TeamAssistantSuggestedAction => item !== null)
    .slice(0, 3);
}

function parseAssistantResponse(rawText: string) {
  const cleaned = stripCodeFences(rawText);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const answer = safeString(parsed.answer ?? parsed.content ?? parsed.text).trim();
    const suggestedActions = parseSuggestedActions(parsed.suggestedActions);

    if (answer) {
      return { answer, suggestedActions };
    }
  } catch {
    // fall back to plain text
  }

  return {
    answer: rawText.trim(),
    suggestedActions: [],
  };
}

function serializeMessages(messages: ChatBubble[]) {
  return JSON.stringify(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      suggestedActions: message.suggestedActions ?? [],
    })),
  );
}

function deserializeMessages(value: string | null): ChatBubble[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): ChatBubble | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const id = safeString(record.id).trim();
        const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
        const content = safeString(record.content).trim();
        const suggestedActions = parseSuggestedActions(record.suggestedActions);

        if (!id || !role || !content) {
          return null;
        }

        return {
          id,
          role,
          content,
          suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
        } as ChatBubble;
      })
      .filter((item): item is ChatBubble => item !== null)
      .slice(-MAX_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

async function readResponseText(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = (await response.json()) as Record<string, unknown>;
      const message = safeString(parsed.error ?? parsed.message ?? parsed.answer ?? parsed.text).trim();
      if (message) {
        return message;
      }
      return JSON.stringify(parsed);
    } catch {
      return "";
    }
  }

  return (await response.text()).trim();
}

export function TeamAssistantPanel({
  open,
  teamId,
  teamName,
  accessToken,
  isDemo,
  context,
  onClose,
  onNavigate,
  onOpenMeeting,
}: TeamAssistantPanelProps) {
  const storageKey = useMemo(() => getStorageKey(teamId, isDemo), [isDemo, teamId]);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setMessages(deserializeMessages(window.sessionStorage.getItem(storageKey)));
    setDraft("");
    setError("");
    setIsSending(false);
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(storageKey, serializeMessages(trimMessages(messages)));
  }, [messages, storageKey]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }, [messages, isSending, open]);

  const quickQuestions = useMemo(() => RECOMMENDED_QUESTIONS.slice(0, 4), []);

  if (!open) {
    return null;
  }

  const pushAssistantMessage = (
    answer: string,
    suggestedActions: TeamAssistantSuggestedAction[] = [],
  ) => {
    const nextMessage: ChatBubble = {
      id: makeId("assistant"),
      role: "assistant",
      content: answer,
      suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
    };

    setMessages((current) => trimMessages([...current, nextMessage]));
    setError("");
  };

  const executeSuggestedAction = (action: TeamAssistantSuggestedAction) => {
    if (action.type === "open_tasks") {
      onNavigate("tasks");
      return;
    }

    if (action.type === "open_schedule") {
      onNavigate("schedule");
      return;
    }

    if (action.type === "open_files") {
      onNavigate("files");
      return;
    }

    if (action.type === "open_meeting") {
      onNavigate("schedule");
      onOpenMeeting(action.targetId && action.targetId.trim() ? action.targetId : context.meetings[0]?.id ?? null);
    }
  };

  const sendQuestion = async (question: string) => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isSending) {
      return;
    }

    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      setError(`질문은 ${MAX_QUESTION_LENGTH}자 이하로 입력해 주세요.`);
      return;
    }

    const userMessage: ChatBubble = {
      id: makeId("user"),
      role: "user",
      content: trimmedQuestion,
    };

    setError("");
    setIsSending(true);
    setDraft("");
    setMessages((current) => trimMessages([...current, userMessage]));

    try {
      if (isDemo || !teamId) {
        const demoResponse = buildDemoAssistantResponse(trimmedQuestion, context);
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        pushAssistantMessage(demoResponse.answer, demoResponse.suggestedActions);
        return;
      }

      if (!accessToken) {
        throw new Error("missing_access_token");
      }

      const response = await fetch("/api/team-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          teamId,
          messages: trimMessages([
            ...messages,
            userMessage,
          ]).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          context,
        }),
      });

      const rawText = await readResponseText(response);
      if (!response.ok) {
        throw new Error(rawText || "ai_request_failed");
      }

      const parsed = parseAssistantResponse(rawText);
      pushAssistantMessage(
        parsed.answer || "현재 저장된 데이터에서는 확인할 수 없습니다.",
        parsed.suggestedActions,
      );
    } catch {
      setDraft(trimmedQuestion);
      setError("AI 답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/35 px-0 py-0 sm:px-4 sm:py-4">
      <div className="flex h-full w-full items-end justify-end sm:items-stretch">
        <section className="flex h-[min(100dvh,100%)] w-full flex-col overflow-hidden bg-white shadow-soft sm:h-full sm:max-w-[min(460px,calc(100vw-2rem))] sm:rounded-[28px]">
          <header className="border-b border-line px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex items-center gap-3">
                <CarryMateLogo variant="symbol" size="sm" decorative className="!h-[34px] !w-[34px] shrink-0" />
                <p className="whitespace-nowrap text-base font-semibold uppercase tracking-[0.18em] text-brand sm:text-lg">
                  CarryMate AI
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setDraft("");
                  setError("");
                  if (typeof window !== "undefined") {
                    window.sessionStorage.removeItem(storageKey);
                  }
                }}
                className="rounded-full border border-line bg-white px-3 py-2 text-[12px] font-semibold text-muted transition hover:bg-canvas"
              >
                새 대화
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-canvas px-3 py-2 text-[12px] font-semibold text-muted transition hover:bg-[#eef2f7]"
              >
                닫기
              </button>
              </div>
            </div>
            <div className="mt-3 min-w-0">
              <h2 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
                {teamName}
              </h2>
              <p className="mt-1 break-keep text-[13px] leading-6 text-muted sm:text-base lg:whitespace-nowrap">
                현재 팀 데이터를 바탕으로 답변해 드려요.
              </p>
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {messages.length === 0 ? (
              <div className="rounded-[24px] border border-[#edf0f6] bg-[#fafcff] px-4 py-5 shadow-card">
                <p className="text-[14px] font-semibold text-ink">무엇이 궁금한가요?</p>
                <p className="mt-1 break-keep text-[12px] leading-6 text-muted">
                  오늘의 업무, 회의, 자료를 바탕으로 바로 질문할 수 있어요.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {quickQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void sendQuestion(question)}
                      disabled={isSending}
                      className="rounded-2xl border border-[#e7edf8] bg-white px-3 py-3 text-left text-[12px] font-semibold text-[#334155] transition hover:border-[#cfdaf2] hover:bg-[#f7f9fd] disabled:opacity-60"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-[22px] px-4 py-3 text-[13px] leading-6 sm:text-[14px] ${
                    message.role === "user"
                      ? "bg-[#1e70e6] text-white"
                      : "border border-[#e7edf8] bg-[#f7f9fd] text-[#283246]"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-keep">{message.content}</p>
                  {message.suggestedActions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.suggestedActions.map((action) => (
                        <button
                          key={`${message.id}-${action.type}-${action.label}`}
                          type="button"
                          onClick={() => executeSuggestedAction(action)}
                          className="rounded-full bg-white/90 px-3 py-2 text-[11px] font-semibold text-[#1e70e6] shadow-sm transition hover:bg-white"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            {isSending ? (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-[22px] border border-[#e7edf8] bg-[#f7f9fd] px-4 py-3 text-[13px] leading-6 text-[#283246]">
                  <p className="font-semibold text-brand">
                    CarryMate AI가 팀 데이터를 확인하고 있어요.
                  </p>
                  <p className="mt-1 break-keep text-muted">
                    잠시만 기다려 주세요.
                  </p>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[18px] border border-[#f2d7d7] bg-[#fff7f7] px-4 py-3 text-[12px] leading-6 text-[#b54d4d] sm:text-[13px]">
                {error}
              </div>
            ) : null}
          </div>

          <div className="border-t border-line bg-white px-4 py-4 sm:px-5">
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold text-ink">질문</span>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || isComposing) {
                    return;
                  }

                  event.preventDefault();
                  void sendQuestion(draft);
                }}
                placeholder="업무, 회의, 자료에 대해 물어보세요."
                rows={3}
                maxLength={MAX_QUESTION_LENGTH}
                className="w-full resize-none rounded-[20px] border border-line bg-white px-4 py-3 text-[13px] leading-6 outline-none transition placeholder:text-[#9aa3b2] focus:border-brand sm:text-[14px]"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] leading-5 text-muted sm:text-[12px]">
                Enter는 전송, Shift+Enter는 줄바꿈입니다.
              </p>
              <button
                type="button"
                onClick={() => void sendQuestion(draft)}
                disabled={isSending || !draft.trim()}
                className="rounded-2xl bg-brand px-4 py-3 text-[13px] font-semibold text-white shadow-brand transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                전송
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}




