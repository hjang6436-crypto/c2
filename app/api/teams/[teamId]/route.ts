import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  hasSupabaseServiceRoleConfig,
  supabasePublishableKey,
  supabaseServiceRoleKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import { TEAM_FILES_BUCKET } from "@/lib/supabase/files";

type StageError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function logTeamDeleteFailure(stage: string, teamId: string, error: unknown) {
  const stageError = error as StageError | undefined;
  console.error("team-delete-failure", {
    stage,
    teamId,
    message: stageError?.message ?? "",
    code: stageError?.code ?? "",
    details: stageError?.details ?? "",
    hint: stageError?.hint ?? "",
  });
}

function fail(stage: string, teamId: string, message: string, error?: unknown) {
  if (error) {
    logTeamDeleteFailure(stage, teamId, error);
  }

  return NextResponse.json(
    {
      ok: false,
      stage,
      message,
    },
    { status: 500 },
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  if (!hasSupabaseServiceRoleConfig()) {
    logTeamDeleteFailure("config", "", {
      message: "SUPABASE_SERVICE_ROLE_KEY is missing",
      code: "",
      details: "",
      hint: "",
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "config",
        message: "? ??젣瑜?泥섎━?????놁뒿?덈떎. ?쒕쾭 ?ㅼ젙???뺤씤??二쇱꽭??",
      },
      { status: 500 },
    );
  }

  const { teamId } = await params;
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!accessToken) {
    logTeamDeleteFailure("token", teamId, {
      message: "Missing authorization bearer token",
      code: "",
      details: "",
      hint: "",
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "token",
        message: "濡쒓렇?몄씠 ?꾩슂?⑸땲??",
      },
      { status: 401 },
    );
  }

  const authClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return fail("user", teamId, "濡쒓렇???뺣낫瑜??뺤씤?????놁뒿?덈떎.", userError);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data: leaderRow, error: leaderError } = await adminClient
    .from("team_members")
    .select("id,is_leader,profile_id,team_id")
    .eq("team_id", teamId)
    .eq("profile_id", userData.user.id)
    .maybeSingle();

  if (leaderError) {
    return fail("team_members", teamId, "???沅뚰븳???뺤씤?????놁뒿?덈떎.", leaderError);
  }

  if (!leaderRow?.is_leader) {
    logTeamDeleteFailure("team_members", teamId, {
      message: "Current user is not a team leader",
      code: "",
      details: "",
      hint: "",
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "team_members",
        message: "??λ쭔 ?????젣?????덉뒿?덈떎.",
      },
      { status: 403 },
    );
  }

  const { data: sharedFiles, error: sharedFilesError } = await adminClient
    .from("shared_files")
    .select("id")
    .eq("team_id", teamId);

  if (sharedFilesError) {
    return fail("shared_files", teamId, "?먮즺 紐⑸줉???뺤씤?????놁뒿?덈떎.", sharedFilesError);
  }

  const sharedFileIds = (sharedFiles ?? []).map((row) => row.id);
  const versionsResult =
    sharedFileIds.length > 0
      ? await adminClient
          .from("file_versions")
          .select("storage_path,file_id")
          .in("file_id", sharedFileIds)
      : null;

  if (versionsResult?.error) {
    return fail("file_versions", teamId, "?먮즺 ???寃쎈줈瑜??뺤씤?????놁뒿?덈떎.", versionsResult.error);
  }

  const storagePaths = (versionsResult?.data ?? [])
    .map((row) => row.storage_path)
    .filter((value): value is string => Boolean(value))
    .filter((value) => /^https?:\/\//i.test(value) === false);

  if (storagePaths.length > 0) {
    const { error: storageError } = await adminClient.storage
      .from(TEAM_FILES_BUCKET)
      .remove(storagePaths);

    if (storageError) {
      const storageErrorMeta = storageError as StageError;
      const storageErrorCode = storageErrorMeta.code ?? "";
      const storageErrorMessage = storageErrorMeta.message ?? "";
      const ignoreMissingObject =
        storageErrorCode === "404" ||
        /not\s*found/i.test(storageErrorMessage) ||
        /does not exist/i.test(storageErrorMessage);

      if (!ignoreMissingObject) {
        return fail("storage", teamId, "?쇰? ??μ냼 ?뚯씪????젣?섏? 紐삵뻽?듬땲??", storageError);
      }
    }
  }

  const { error: deleteError } = await adminClient.from("teams").delete().eq("id", teamId);
  if (deleteError) {
    return fail("teams", teamId, "? ??젣???ㅽ뙣?덉뒿?덈떎.", deleteError);
  }

  return NextResponse.json({
    ok: true,
    message: "?????젣?섏뿀?듬땲??",
  });
}

