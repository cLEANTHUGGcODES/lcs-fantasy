import { requireAuthUser } from "@/lib/draft-auth";
import {
  MAX_GLOBAL_CHAT_MESSAGE_LENGTH,
  createGlobalChatMessage,
  listGlobalChatMessages,
  normalizeGlobalChatMessage,
} from "@/lib/global-chat";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import {
  getUserAvatarBorderColor,
  getUserAvatarUrl,
  getUserDisplayName,
  getUserTeamName,
} from "@/lib/user-profile";

type PostChatBody = {
  message?: string;
};

const buildSenderLabel = ({
  teamName,
  userLabel,
}: {
  teamName: string | null;
  userLabel: string;
}): string => (teamName ? `${teamName} (${userLabel})` : userLabel);

export async function GET() {
  try {
    await requireAuthUser();
    const messages = await listGlobalChatMessages();
    return Response.json({ messages }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load chat.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthUser();
    const body = (await request.json()) as PostChatBody;
    const message = normalizeGlobalChatMessage(body.message ?? "");
    if (!message) {
      return Response.json({ error: "Message cannot be empty." }, { status: 400 });
    }
    if (message.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH) {
      return Response.json(
        {
          error: `Message must be ${MAX_GLOBAL_CHAT_MESSAGE_LENGTH} characters or fewer.`,
        },
        { status: 400 },
      );
    }

    const userLabel = getUserDisplayName(user) ?? user.id;
    const teamName = getUserTeamName(user);
    const senderLabel = buildSenderLabel({ teamName, userLabel });

    const createdMessage = await createGlobalChatMessage({
      userId: user.id,
      senderLabel,
      message,
    });
    const { supabaseUrl } = getSupabaseAuthEnv();
    const senderAvatarUrl = getUserAvatarUrl({
      user,
      supabaseUrl,
    });
    const senderAvatarBorderColor = getUserAvatarBorderColor(user);
    return Response.json(
      {
        message: {
          ...createdMessage,
          senderAvatarUrl,
          senderAvatarBorderColor,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send chat message.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
