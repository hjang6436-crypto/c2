import { useEffect, useMemo, useState } from "react";
import {
  ConfirmedMeeting,
  ScheduleSlot,
  TeamAvailabilityEntry,
  TeamMember,
} from "@/types/carrymate";

type AttendanceStatus = "attending" | "late" | "absent";
type MeetingPresetInput = {
  title: string;
  startsAt: string;
  endsAt: string;
};
type PeriodOption = {
  id: number;
  label: string;
  start: string;
  end: string;
};
type RuleItem = {
  id: string;
  text: string;
  checked: boolean;
};

const ATTENDANCE_ORDER: AttendanceStatus[] = ["attending", "late", "absent"];
const ATTENDANCE_META: Record<AttendanceStatus, { label: string; className: string }> = {
  attending: { label: "참석", className: "bg-emerald-50 text-emerald-600" },
  late: { label: "지각", className: "bg-amber-50 text-amber-600" },
  absent: { label: "불참", className: "bg-rose-50 text-rose-600" },
};

const INITIAL_RULES: RuleItem[] = [
  { id: "r1", text: "회의 시작 10분 전까지 입장하기", checked: true },
  { id: "r2", text: "안건은 짧고 명확하게 정리하기", checked: true },
  { id: "r3", text: "회의 종료 전에 다음 할 일 정하기", checked: false },
];

const MEETING_STATUS_META = {
  scheduled: {
    label: "예정",
    className: "bg-violet-50 text-violet-600",
  },
  inProgress: {
    label: "진행 중",
    className: "bg-blue-50 text-brand",
  },
  ended: {
    label: "종료",
    className: "bg-slate-100 text-slate-600",
  },
} as const;

const DAY_LABELS = ["월", "화", "수", "목", "금"];
const DAY_NAME_BY_FULL = ["월요일", "화요일", "수요일", "목요일", "금요일"];
const BASE_PERIODS: PeriodOption[] = [
  { id: 1, label: "1교시", start: "09:00", end: "10:00" },
  { id: 2, label: "2교시", start: "10:00", end: "11:00" },
  { id: 3, label: "3교시", start: "11:00", end: "12:00" },
  { id: 4, label: "4교시", start: "12:00", end: "13:00" },
  { id: 5, label: "5교시", start: "13:00", end: "14:00" },
  { id: 6, label: "6교시", start: "14:00", end: "15:00" },
  { id: 7, label: "7교시", start: "15:00", end: "16:00" },
  { id: 8, label: "8교시", start: "16:00", end: "17:00" },
  { id: 9, label: "9교시", start: "17:00", end: "18:00" },
];
const NIGHT_PERIODS: PeriodOption[] = [
  { id: 10, label: "10교시", start: "18:00", end: "19:00" },
  { id: 11, label: "11교시", start: "19:00", end: "20:00" },
  { id: 12, label: "12교시", start: "20:00", end: "21:00" },
];
const ALL_PERIODS = [...BASE_PERIODS, ...NIGHT_PERIODS];

function buildAvailabilityKey(day: number, time: string) {
  return `${day}|${time}`;
}

function parseRecommendedDayIndex(dateLabel: string) {
  for (const [index, dayLabel] of DAY_LABELS.entries()) {
    if (dateLabel.includes(dayLabel)) {
      return index;
    }
  }

  if (dateLabel.includes("오늘")) {
    const today = new Date().getDay();
    if (today >= 1 && today <= 5) {
      return today - 1;
    }
  }

  return null;
}

function parseRangeStart(timeRange: string) {
  const start = timeRange.split("-")[0]?.trim() ?? "";
  return /^\d{2}:\d{2}$/.test(start) ? start : "";
}

function parseRangeEnd(timeRange: string) {
  const end = timeRange.split("-")[1]?.trim() ?? "";
  return /^\d{2}:\d{2}$/.test(end) ? end : "";
}

function getRecommendedKeys(slot: ScheduleSlot) {
  const dayIndex = parseRecommendedDayIndex(slot.dateLabel);
  const start = parseRangeStart(slot.timeRange);
  const end = parseRangeEnd(slot.timeRange);

  if (dayIndex === null || !start || !end) {
    return [];
  }

  return ALL_PERIODS.flatMap((period) =>
    period.start >= start && period.start < end
      ? [buildAvailabilityKey(dayIndex, period.start)]
      : [],
  );
}

function findDayNameByKeys(keys: string[]) {
  const counts = new Map<number, number>();

  keys.forEach((key) => {
    const [day] = key.split("|");
    const dayIndex = Number(day);
    if (Number.isNaN(dayIndex) || dayIndex < 0 || dayIndex > 4) {
      return;
    }

    counts.set(dayIndex, (counts.get(dayIndex) ?? 0) + 1);
  });

  if (counts.size === 0) {
    return "없음";
  }

  const sorted = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0] - right[0];
  });

  return DAY_NAME_BY_FULL[sorted[0][0]];
}

function findLeastDayName(keys: string[]) {
  if (keys.length === 0) {
    return "없음";
  }

  const counts = DAY_LABELS.map((_, index) => ({
    dayIndex: index,
    count: 0,
  }));

  keys.forEach((key) => {
    const [day] = key.split("|");
    const dayIndex = Number(day);
    if (Number.isNaN(dayIndex) || dayIndex < 0 || dayIndex > 4) {
      return;
    }

    counts[dayIndex].count += 1;
  });

  counts.sort((left, right) => {
    if (left.count !== right.count) {
      return left.count - right.count;
    }

    return left.dayIndex - right.dayIndex;
  });

  return DAY_NAME_BY_FULL[counts[0].dayIndex];
}

function getPeriodLabelFromRange(timeRange: string) {
  const start = parseRangeStart(timeRange);
  const end = parseRangeEnd(timeRange);
  if (!start || !end) {
    return timeRange;
  }

  const matched = ALL_PERIODS.filter(
    (period) => period.start >= start && period.start < end,
  );

  if (matched.length === 0) {
    return timeRange;
  }

  if (matched.length === 1) {
    return matched[0].label;
  }

  return `${matched[0].label} ~ ${matched[matched.length - 1].label}`;
}

function getPresetForSlot(slot: ScheduleSlot): MeetingPresetInput | null {
  const dayIndex = parseRecommendedDayIndex(slot.dateLabel);
  const start = parseRangeStart(slot.timeRange);
  const end = parseRangeEnd(slot.timeRange);

  if (dayIndex === null || !start || !end) {
    return null;
  }

  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay = baseDate.getDay();
  const targetDay = dayIndex + 1;
  const offset = (targetDay - currentDay + 7) % 7;
  baseDate.setDate(baseDate.getDate() + offset);

  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);

  const startsAt = new Date(baseDate);
  startsAt.setHours(startHour, startMinute, 0, 0);

  const endsAt = new Date(baseDate);
  endsAt.setHours(endHour, endMinute, 0, 0);

  const toInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  };

  return {
    title: slot.label,
    startsAt: toInput(startsAt),
    endsAt: toInput(endsAt),
  };
}

export function ScheduleTab({
  meetings,
  members,
  onAddSchedule,
  onConfirmSlot,
  onCreateMeeting,
  onOpenMeeting,
  slots,
  editableMember,
  selectedAvailabilityKeys,
  teamAvailability,
  availabilityLoading,
  availabilitySaving,
  availabilityMessage,
  hasAvailabilityChanges,
  onToggleAvailability,
  onSaveAvailability,
}: {
  meetings: ConfirmedMeeting[];
  members: TeamMember[];
  onAddSchedule: () => void;
  onConfirmSlot: (slotId: string) => void;
  onCreateMeeting: (preset?: MeetingPresetInput) => void;
  onOpenMeeting: (meetingId: string) => void;
  slots: ScheduleSlot[];
  editableMember: TeamMember | null;
  selectedAvailabilityKeys: string[];
  teamAvailability: TeamAvailabilityEntry[];
  availabilityLoading: boolean;
  availabilitySaving: boolean;
  availabilityMessage: string;
  hasAvailabilityChanges: boolean;
  onToggleAvailability: (day: number, time: string) => void;
  onSaveAvailability: () => void;
}) {
  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>(
    {},
  );
  const [rules, setRules] = useState<RuleItem[]>(INITIAL_RULES);
  const [ruleInput, setRuleInput] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [showNightPeriods, setShowNightPeriods] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<{
    dayIndex: number;
    periodIndex: number;
  } | null>(null);
  const [localToast, setLocalToast] = useState("");
  const selectedAvailabilitySet = useMemo(
    () => new Set(selectedAvailabilityKeys),
    [selectedAvailabilityKeys],
  );
  const visiblePeriods = showNightPeriods ? ALL_PERIODS : BASE_PERIODS;
  const availabilityCountByKey = useMemo(() => {
    const counts = new Map<string, number>();

    teamAvailability.forEach((entry) => {
      const key = buildAvailabilityKey(entry.day, entry.time);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return counts;
  }, [teamAvailability]);
  const recommendedSlots = useMemo(
    () => slots.filter((slot) => slot.recommended),
    [slots],
  );
  const recommendedAvailabilityKeys = useMemo(() => {
    const set = new Set<string>();

    recommendedSlots.forEach((slot) => {
      getRecommendedKeys(slot).forEach((key) => set.add(key));
    });

    return set;
  }, [recommendedSlots]);
  const teamAvailabilityStats = useMemo(() => {
    const counts = [...availabilityCountByKey.entries()];
    const totalMembers = activeMembers.length;
    const allMemberCount =
      totalMembers > 0
        ? counts.filter(([, count]) => count === totalMembers).length
        : 0;
    const threePlusCount = counts.filter(([, count]) => count >= 3).length;
    const topRecommendation = recommendedSlots[0] ?? null;

    return {
      allMemberCount,
      threePlusCount,
      topRecommendation,
    };
  }, [activeMembers.length, availabilityCountByKey, recommendedSlots]);
  const myAvailabilityStats = useMemo(() => {
    const selected = [...selectedAvailabilitySet];

    return {
      total: selected.length,
      busiestDay: findDayNameByKeys(selected),
      quietDay: findLeastDayName(selected),
    };
  }, [selectedAvailabilitySet]);

  useEffect(() => {
    if (!availabilityMessage.startsWith("✅")) {
      return;
    }

    setLocalToast(availabilityMessage);
  }, [availabilityMessage]);

  useEffect(() => {
    if (!localToast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setLocalToast("");
    }, 2200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [localToast]);

  const cycleAttendance = (meetingId: string, memberId: string) => {
    const key = `${meetingId}-${memberId}`;
    const current = attendanceMap[key] ?? "attending";
    const next =
      ATTENDANCE_ORDER[
        (ATTENDANCE_ORDER.indexOf(current) + 1) % ATTENDANCE_ORDER.length
      ];
    setAttendanceMap((prev) => ({ ...prev, [key]: next }));
  };

  const handlePeriodClick = (dayIndex: number, periodIndex: number) => {
    const period = visiblePeriods[periodIndex];
    if (!period) {
      return;
    }

    if (!rangeAnchor || rangeAnchor.dayIndex !== dayIndex) {
      onToggleAvailability(dayIndex, period.start);
      setRangeAnchor({ dayIndex, periodIndex });
      return;
    }

    if (rangeAnchor.periodIndex === periodIndex) {
      setRangeAnchor(null);
      return;
    }

    const startIndex = Math.min(rangeAnchor.periodIndex, periodIndex);
    const endIndex = Math.max(rangeAnchor.periodIndex, periodIndex);
    const rangeKeys = visiblePeriods
      .slice(startIndex, endIndex + 1)
      .map((item) => buildAvailabilityKey(dayIndex, item.start));
    const allSelected = rangeKeys.every((key) => selectedAvailabilitySet.has(key));

    visiblePeriods.slice(startIndex, endIndex + 1).forEach((item) => {
      const key = buildAvailabilityKey(dayIndex, item.start);
      const shouldToggle =
        (allSelected && selectedAvailabilitySet.has(key)) ||
        (!allSelected && !selectedAvailabilitySet.has(key));

      if (shouldToggle) {
        onToggleAvailability(dayIndex, item.start);
      }
    });

    setRangeAnchor(null);
  };

  const handleAddRule = () => {
    const trimmed = ruleInput.trim();
    if (!trimmed) {
      return;
    }

    setRules((current) => [
      ...current,
      { id: `rule-${Date.now()}`, text: trimmed, checked: false },
    ]);
    setRuleInput("");
  };

  const handleStartEditRule = (rule: RuleItem) => {
    setEditingRuleId(rule.id);
    setEditingRuleText(rule.text);
  };

  const handleSaveRule = (ruleId: string) => {
    const trimmed = editingRuleText.trim();
    if (!trimmed) {
      return;
    }

    setRules((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, text: trimmed } : rule)),
    );
    setEditingRuleId(null);
    setEditingRuleText("");
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
    if (editingRuleId === ruleId) {
      setEditingRuleId(null);
      setEditingRuleText("");
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {localToast ? (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#1f2937] px-4 py-2 text-[12px] font-semibold text-white shadow-lg">
          {localToast}
        </div>
      ) : null}

      <section className="rounded-[26px] border-l-4 border-[#6259e8] bg-white p-5 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-[#7b74ee] sm:text-xs">이번 주 회의 관리</p>
            <h2 className="mt-2 text-[23px] font-extrabold leading-7 text-[#262236] sm:text-[26px] lg:text-[30px] break-keep">
              일정과 회의를 한 곳에서 정리
            </h2>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onCreateMeeting()}
              className="rounded-full bg-[#6259e8] px-3 py-2 text-[11px] font-bold text-white"
            >
              + 회의
            </button>
            <button
              onClick={onAddSchedule}
              className="rounded-full border border-[#dcd6ff] bg-white px-3 py-2 text-[11px] font-bold text-[#6259e8] sm:text-xs"
            >
              + 일정
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniStat label="전체 일정" value={`${slots.length + meetings.length}개`} />
          <MiniStat label="참여 인원" value={`${activeMembers.length}명`} />
        </div>
      </section>

      <section className="rounded-[26px] border border-[#eeeaf7] bg-white p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-[#7b74ee] sm:text-xs">팀 공강 입력</p>
            <h3 className="mt-2 text-[18px] font-extrabold text-[#2d293b] sm:text-xl lg:text-2xl break-keep">
              팀 공강 입력
            </h3>
            <p className="mt-2 text-[11px] leading-5 text-[#938ca1] sm:text-xs lg:text-sm break-keep">
              시작 교시와 마지막 교시를 선택하면 사이 시간도 함께 선택됩니다.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1.55fr,0.9fr]">
          <div className="overflow-x-auto rounded-[22px] border border-[#e4def0] bg-[#e4def0] p-px">
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[44px_repeat(5,minmax(0,1fr))] gap-px">
                <div className="min-h-[44px] bg-[#f7f6fd]" />
              {DAY_LABELS.map((day) => (
                <div
                  key={day}
                  className="flex min-h-[44px] items-center justify-center bg-[#f7f6fd] px-1 text-center text-[10px] font-extrabold text-[#6259e8] sm:text-[11px]"
                >
                  {day}
                </div>
              ))}

              {visiblePeriods.map((period, periodIndex) => (
                <PeriodRow
                  key={period.id}
                  counts={availabilityCountByKey}
                  disabled={!editableMember || availabilitySaving}
                  period={period}
                  periodIndex={periodIndex}
                  rangeAnchor={rangeAnchor}
                  recommendedKeys={recommendedAvailabilityKeys}
                  selectedKeys={selectedAvailabilitySet}
                  onClick={handlePeriodClick}
                />
              ))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowNightPeriods((current) => !current)}
                className="rounded-full border border-[#dcd6ff] bg-white px-3 py-2 text-[10px] font-bold text-[#6259e8]"
              >
                {showNightPeriods ? "야간 교시 숨기기" : "야간 교시 보기"}
              </button>
              <p className="text-[10px] font-semibold text-[#938ca1]">
                {availabilityLoading
                  ? "공강 불러오는 중"
                  : hasAvailabilityChanges
                    ? "저장되지 않은 변경 사항이 있습니다."
                    : "저장된 공강 상태입니다."}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <StatCard
              title="내 공강 요약"
              rows={[
                { label: "총 공강", value: `${myAvailabilityStats.total}교시` },
                { label: "가장 여유 있는 요일", value: myAvailabilityStats.busiestDay },
                { label: "가장 적은 요일", value: myAvailabilityStats.quietDay },
              ]}
            />
            <StatCard
              title="팀 공강 요약"
              rows={[
                {
                  label: "전원 가능 시간",
                  value: `${teamAvailabilityStats.allMemberCount}개`,
                },
                {
                  label: "3명 이상 가능 시간",
                  value: `${teamAvailabilityStats.threePlusCount}개`,
                },
                {
                  label: "추천 시간",
                  value: teamAvailabilityStats.topRecommendation
                    ? `${teamAvailabilityStats.topRecommendation.dateLabel} ${getPeriodLabelFromRange(teamAvailabilityStats.topRecommendation.timeRange)}`
                    : "없음",
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-bold">
          <LegendChip className="border border-emerald-500 bg-emerald-500 text-white" label="내 공강" />
          <LegendChip className="border border-blue-200 bg-blue-100 text-blue-700" label="팀원 공강" />
          <LegendChip className="border border-[#e7e2f0] bg-white text-[#938ca1]" label="미입력" />
          <LegendChip className="border border-[#6259e8] bg-[#6259e8] text-white" label="추천 시간" />
        </div>

        {availabilityMessage && !availabilityMessage.startsWith("✅") ? (
          <p className="mt-4 rounded-2xl bg-[#faf9ff] px-4 py-3 text-[12px] leading-6 text-[#5d5768]">
            {availabilityMessage}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold text-[#938ca1]">
            {hasAvailabilityChanges
              ? "저장되지 않은 변경 사항이 있습니다."
              : "선택한 공강 시간이 저장된 상태와 같습니다."}
          </p>
          <button
            type="button"
            disabled={!editableMember || availabilityLoading || availabilitySaving}
            onClick={onSaveAvailability}
            className="rounded-2xl bg-[#6259e8] px-4 py-3 text-[12px] font-bold text-white disabled:opacity-60"
          >
            {availabilitySaving ? "저장 중..." : "공강 저장"}
          </button>
        </div>
      </section>

      <SectionTitle title="팀플 가능한 시간" action="일정 추가" onClick={onAddSchedule} />
      <div className="space-y-3">
        {recommendedSlots.length > 0 ? (
          recommendedSlots.map((slot, index) => {
            const availableNames = slot.memberIds
              .map((memberId) => activeMembers.find((member) => member.id === memberId)?.name)
              .filter((value): value is string => Boolean(value));
            const preset = getPresetForSlot(slot);
            const rating = Math.max(
              1,
              Math.min(
                5,
                Math.round((availableNames.length / Math.max(activeMembers.length, 1)) * 5),
              ),
            );

            return (
              <article
                key={slot.id}
                className="rounded-[24px] border border-[#e5ddff] bg-white p-5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-[#7b74ee] sm:text-xs">추천 {index + 1}</p>
                    <h3 className="mt-2 text-[18px] font-extrabold text-[#2d293b] sm:text-xl lg:text-2xl break-keep">
                      {slot.dateLabel}
                    </h3>
                    <p className="mt-1 text-[13px] font-semibold text-[#6259e8] sm:text-sm break-keep">
                      {getPeriodLabelFromRange(slot.timeRange)}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#6259e8] px-3 py-1 text-[10px] font-bold text-white">
                    {"★".repeat(rating)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <InfoTile label="가능 인원" value={`${availableNames.length} / ${activeMembers.length}명`} />
                  <InfoTile
                    label="추천 이유"
                    value={
                      availableNames.length === activeMembers.length
                        ? "모든 팀원이 참석 가능한 우선 시간입니다."
                        : "여러 팀원이 겹치는 시간이라 회의 잡기가 수월합니다."
                    }
                  />
                </div>

                <div className="mt-4 rounded-2xl bg-[#faf9ff] px-4 py-3">
                  <p className="text-[11px] font-bold text-[#6259e8] sm:text-xs">가능 인원</p>
                  <p className="mt-2 text-[12px] leading-6 text-[#5d5768]">
                    {availableNames.length > 0 ? availableNames.join(" · ") : "가능 인원 정보 없음"}
                  </p>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onConfirmSlot(slot.id)}
                    className="flex-1 rounded-2xl border border-[#dcd6ff] bg-white px-4 py-3 text-[11px] font-bold text-[#6259e8] sm:text-xs"
                  >
                    추천 확정
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreateMeeting(preset ?? undefined)}
                    className="flex-1 rounded-2xl bg-[#6259e8] px-4 py-3 text-[11px] font-bold text-white"
                  >
                    회의 만들기
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <Empty text="팀플 가능한 시간이 아직 없습니다." />
        )}
      </div>

      <SectionTitle title="프로젝트 회의" action="회의 만들기" onClick={() => onCreateMeeting()} />
      <div className="space-y-3">
        {meetings.length > 0 ? (
          meetings.map((meeting, index) => {
            const statusMeta = MEETING_STATUS_META[meeting.status];
            const hasAiNote = Boolean(meeting.aiSummary || meeting.noteId);
            const hasTransferredTasks = Boolean(
              meeting.aiActionItems?.length &&
                meeting.aiActionItems.every((item) => item.transferred),
            );

            return (
              <article
                key={meeting.id}
                className="rounded-[22px] border border-[#eeeaf7] bg-white p-4 shadow-card"
              >
                <div className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0eeff] text-[11px] font-extrabold text-[#6259e8]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="line-clamp-2 break-words text-[13px] font-extrabold text-[#332f42] sm:text-sm lg:text-base">
                        {meeting.title}
                      </p>
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-bold ${statusMeta.className}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-nowrap text-[11px] text-[#958fa1] sm:text-xs">
                      {meeting.dateLabel} · {meeting.timeRange}
                    </p>
                  </div>
                </div>

                {hasAiNote || hasTransferredTasks ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {hasAiNote ? (
                      <span className="rounded-full bg-[#eef5ff] px-2 py-1 text-[9px] font-bold text-[#1e70e6]">
                        AI 회의록 있음
                      </span>
                    ) : null}
                    {hasTransferredTasks ? (
                      <span className="rounded-full bg-[#ebfaf1] px-2 py-1 text-[9px] font-bold text-[#15803d]">
                        Tasks 생성 완료
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {activeMembers.map((member) => {
                    const key = `${meeting.id}-${member.id}`;
                    const status = attendanceMap[key] ?? "attending";

                    return (
                      <button
                        key={key}
                        onClick={() => cycleAttendance(meeting.id, member.id)}
                        className={`rounded-full px-3 py-1.5 text-[9px] font-bold ${ATTENDANCE_META[status].className}`}
                      >
                        {member.name} · {ATTENDANCE_META[status].label}
                      </button>
                    );
                  })}
                </div>

                {meeting.aiSummary ? (
                  <div className="mt-4 rounded-2xl bg-[#faf9ff] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6259e8]">
                      AI 요약
                    </p>
                    <p className="mt-2 text-[12px] leading-6 text-[#625c6d]">
                      {meeting.aiSummary}
                    </p>
                  </div>
                ) : null}

                <button
                  onClick={() => onOpenMeeting(meeting.id)}
                  className="mt-4 w-full rounded-xl border border-[#dcd6ff] bg-white py-2.5 text-[11px] font-bold text-[#6259e8] sm:text-xs"
                >
                  회의 채팅 열기
                </button>
              </article>
            );
          })
        ) : (
          <Empty text="아직 생성된 회의가 없습니다." />
        )}
      </div>

      <SectionTitle title="팀 회의 규칙" />
      <section className="space-y-3 rounded-[22px] bg-white p-4 shadow-card">
        <div className="flex gap-2">
          <input
            type="text"
            value={ruleInput}
            onChange={(event) => setRuleInput(event.target.value)}
            placeholder="회의 규칙을 추가해보세요."
            className="flex-1 rounded-2xl border border-line bg-white px-4 py-3 text-[12px] outline-none transition focus:border-brand"
          />
          <button
            type="button"
            onClick={handleAddRule}
            disabled={!ruleInput.trim()}
            className="rounded-2xl bg-[#6259e8] px-4 py-3 text-[11px] font-bold text-white disabled:opacity-60"
          >
            추가
          </button>
        </div>

        {rules.length > 0 ? (
          rules.map((rule) => {
            const isEditing = editingRuleId === rule.id;

            return (
              <div
                key={rule.id}
                className="rounded-2xl bg-[#faf9ff] px-3 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setRules((current) =>
                          current.map((item) =>
                            item.id === rule.id ? { ...item, checked: !item.checked } : item,
                          ),
                        )
                      }
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:h-8 sm:w-8"
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-md text-[11px] sm:h-8 sm:w-8 sm:text-[12px] ${
                          rule.checked
                            ? "bg-[#6259e8] text-white"
                            : "border border-[#dcd7e8] text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </button>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingRuleText}
                          onChange={(event) => setEditingRuleText(event.target.value)}
                          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none transition placeholder:text-muted focus:border-brand sm:text-base"
                        />
                      ) : (
                        <p className="break-keep whitespace-normal text-[14px] font-medium leading-6 text-[#5d5768] sm:text-[15px] lg:text-[16px]">
                          {rule.text}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:ml-auto sm:self-center sm:gap-3">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRuleId(null);
                            setEditingRuleText("");
                          }}
                          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold text-[#8a8397]"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveRule(rule.id)}
                          disabled={!editingRuleText.trim()}
                          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold text-[#6259e8] disabled:opacity-60"
                        >
                          저장
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEditRule(rule)}
                          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold text-[#6259e8]"
                        >
                          ✏ 수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold text-rose-500"
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <Empty text="회의 규칙을 추가해보세요." />
        )}
      </section>
    </div>
  );
}

function PeriodRow({
  counts,
  disabled,
  period,
  periodIndex,
  rangeAnchor,
  recommendedKeys,
  selectedKeys,
  onClick,
}: {
  counts: Map<string, number>;
  disabled: boolean;
  period: PeriodOption;
  periodIndex: number;
  rangeAnchor: { dayIndex: number; periodIndex: number } | null;
  recommendedKeys: Set<string>;
  selectedKeys: Set<string>;
  onClick: (dayIndex: number, periodIndex: number) => void;
}) {
  return (
    <>
      <div className="flex min-h-[52px] flex-col items-center justify-center bg-[#f7f6fd] px-1 text-center">
        <p className="text-[10px] font-extrabold text-[#2d293b] sm:text-[11px]">{period.label}</p>
        <p className="mt-0.5 text-[8px] leading-3 text-[#938ca1] sm:text-[9px]">
          {period.start}
          <br />
          {period.end}
        </p>
      </div>
      {DAY_LABELS.map((_, dayIndex) => {
        const key = buildAvailabilityKey(dayIndex, period.start);
        const count = counts.get(key) ?? 0;
        const isSelected = selectedKeys.has(key);
        const isRecommended = recommendedKeys.has(key);
        const isAnchor =
          rangeAnchor?.dayIndex === dayIndex && rangeAnchor.periodIndex === periodIndex;

        let className = "border-[#e7e2f0] bg-white text-[#938ca1]";

        if (isSelected) {
          className = "border-emerald-500 bg-emerald-500 text-white";
        } else if (isRecommended) {
          className = "border-[#6259e8] bg-[#6259e8] text-white";
        } else if (count > 0) {
          className = "border-blue-200 bg-blue-100 text-blue-700";
        }

        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onClick(dayIndex, periodIndex)}
            aria-pressed={isSelected}
            aria-label={`${DAY_LABELS[dayIndex]} ${period.label} 공강 선택`}
            className={`relative flex min-h-[52px] items-center justify-center bg-white text-[10px] font-extrabold transition sm:text-[11px] ${className} ${isAnchor ? "ring-2 ring-[#1f2937]/20" : ""} hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6259e8] focus-visible:ring-offset-1 disabled:opacity-60`}
          >
            {isSelected ? "✓" : isRecommended ? "★" : count > 0 ? count : ""}
            {isSelected && isRecommended ? (
              <span className="absolute right-1 top-1 text-[9px] text-white">★</span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

function StatCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="rounded-[22px] border border-[#eeeaf7] bg-white p-4 shadow-card">
      <p className="text-[11px] font-bold text-[#7b74ee] sm:text-xs">{title}</p>
      <div className="mt-3 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-2xl bg-[#faf9ff] px-3 py-3">
            <p className="text-[10px] font-semibold text-[#938ca1]">{row.label}</p>
            <p className="mt-1 text-[13px] font-extrabold text-[#2d293b]">{row.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#faf9ff] px-4 py-3">
      <p className="text-[10px] font-bold text-[#7b74ee]">{label}</p>
      <p className="mt-2 text-[12px] leading-5 text-[#5d5768]">{value}</p>
    </div>
  );
}

function LegendChip({ className, label }: { className: string; label: string }) {
  return <span className={`rounded-full px-3 py-1 ${className}`}>{label}</span>;
}

function SectionTitle({
  action,
  onClick,
  title,
}: {
  action?: string;
  onClick?: () => void;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <h3 className="text-[16px] font-extrabold text-[#282438]">{title}</h3>
      {action ? (
        <button onClick={onClick} className="text-[11px] font-bold text-[#6259e8] sm:text-xs">
          {action}
        </button>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#faf9ff] p-3">
      <p className="text-[9px] font-semibold text-[#9a94a8]">{label}</p>
      <p className="mt-1 text-[13px] font-extrabold text-[#4b4558]">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-[#ddd8e9] bg-white px-4 py-7 text-center text-[11px] text-[#948da1]">
      {text}
    </div>
  );
}
