import { JoinInviteFlow } from "@/components/join-invite-flow";

export default async function JoinInvitePage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await params;

  return <JoinInviteFlow inviteCode={inviteCode} />;
}
