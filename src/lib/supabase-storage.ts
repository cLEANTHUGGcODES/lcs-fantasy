export const PROFILE_IMAGES_BUCKET = "profile-images";
export const CHAT_IMAGES_BUCKET = "chat-images";

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const getPublicStorageUrl = ({
  supabaseUrl,
  bucket,
  path,
}: {
  supabaseUrl: string;
  bucket: string;
  path: string;
}): string => `${trimSlash(supabaseUrl)}/storage/v1/object/public/${bucket}/${encodePath(path)}`;
