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

  return <CarryMateApp initialInviteCode={initialInviteCode} />;
}
