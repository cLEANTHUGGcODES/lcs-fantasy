import { requireAuthUser } from "@/lib/draft-auth";
import {
  MAX_CHAT_IMAGE_BYTES,
  extensionForChatImage,
  isSupportedChatImageMimeType,
} from "@/lib/chat-image";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { CHAT_IMAGES_BUCKET, getPublicStorageUrl } from "@/lib/supabase-storage";

const asUploadErrorResponse = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

const createObjectPath = ({
  userId,
  fileName,
  mimeType,
}: {
  userId: string;
  fileName: string;
  mimeType: string;
}): string => {
  const extension = extensionForChatImage({ fileName, mimeType });
  const nonce = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${userId}/${Date.now()}-${nonce}.${extension}`;
};

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthServerClient();
    const user = await requireAuthUser(supabase);
    const formData = await request.formData();
    const fileValue = formData.get("file");

    if (!(fileValue instanceof File)) {
      return asUploadErrorResponse("Image file is required.");
    }

    const mimeType = fileValue.type.trim().toLowerCase();
    if (!isSupportedChatImageMimeType(mimeType)) {
      return asUploadErrorResponse("Use a JPG, PNG, or WEBP image.");
    }
    if (fileValue.size <= 0) {
      return asUploadErrorResponse("Image file is empty.");
    }
    if (fileValue.size > MAX_CHAT_IMAGE_BYTES) {
      return asUploadErrorResponse("Image must be 3MB or smaller.");
    }

    const objectPath = createObjectPath({
      userId: user.id,
      fileName: fileValue.name,
      mimeType,
    });

    const buffer = Buffer.from(await fileValue.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(objectPath, buffer, {
        cacheControl: "31536000",
        contentType: mimeType,
        upsert: false,
      });
    if (uploadError) {
      return asUploadErrorResponse(uploadError.message, 500);
    }

    const { supabaseUrl } = getSupabaseAuthEnv();
    const imageUrl = getPublicStorageUrl({
      supabaseUrl,
      bucket: CHAT_IMAGES_BUCKET,
      path: objectPath,
    });

    return Response.json(
      {
        imageUrl,
        path: objectPath,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload chat image.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
