import type { MeetingMessage } from "@/types/carrymate";

type MeetingNoteContentEnvelope = {
  version: 1 | 2;
  transcript: string;
  agenda?: string | null;
  pinnedMessages?: MeetingMessage[];
  aiUnresolvedItems?: string[];
};

export type ParsedMeetingNoteContent = {
  transcript: string;
  agenda: string | null;
  pinnedMessages: MeetingMessage[];
  aiUnresolvedItems: string[];
};

function isMeetingMessage(value: unknown): value is MeetingMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.meetingId === "string" &&
    (typeof record.memberId === "string" || record.memberId === null) &&
    typeof record.senderName === "string" &&
    typeof record.message === "string" &&
    typeof record.createdAt === "string"
  );
}

export function parseMeetingNoteContent(content: string): ParsedMeetingNoteContent {
  try {
    const parsed = JSON.parse(content) as MeetingNoteContentEnvelope;
    if (
      parsed &&
      (parsed.version === 1 || parsed.version === 2) &&
      typeof parsed.transcript === "string"
    ) {
      return {
        transcript: parsed.transcript,
        agenda: typeof parsed.agenda === "string" ? parsed.agenda : null,
        pinnedMessages: Array.isArray(parsed.pinnedMessages)
          ? parsed.pinnedMessages.filter(isMeetingMessage)
          : [],
        aiUnresolvedItems: Array.isArray(parsed.aiUnresolvedItems)
          ? parsed.aiUnresolvedItems.filter(
              (item): item is string => typeof item === "string" && item.trim().length > 0,
            )
          : [],
      };
    }
  } catch {
    // Keep backward compatibility with old plain text content.
  }

  return {
    transcript: content,
    agenda: null,
    pinnedMessages: [],
    aiUnresolvedItems: [],
  };
}

export function serializeMeetingNoteContent(input: {
  transcript: string;
  agenda?: string | null;
  pinnedMessages?: MeetingMessage[];
  aiUnresolvedItems?: string[];
}) {
  return JSON.stringify({
    version: 2,
    transcript: input.transcript,
    agenda: input.agenda ?? null,
    pinnedMessages: input.pinnedMessages ?? [],
    aiUnresolvedItems: input.aiUnresolvedItems ?? [],
  } satisfies MeetingNoteContentEnvelope);
}
