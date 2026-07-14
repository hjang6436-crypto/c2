import { CarryMateApp } from "@/components/carrymate-app";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const inviteParam = resolvedSearchParams.invite;
  const initialInviteCode =
    typeof inviteParam === "string" ? inviteParam : inviteParam?.[0];

  return (
    <>
      <div className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg">
        Vercel 자동 배포 테스트 완료
      </div>
      <CarryMateApp initialInviteCode={initialInviteCode} />
    </>
  );
}
