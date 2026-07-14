export function formatDeadlineLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return date;
  }

  return `${month}월 ${day}일 발표`;
}
