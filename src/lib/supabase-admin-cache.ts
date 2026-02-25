import type { User } from "@supabase/supabase-js";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarBorderColor, getUserAvatarUrl } from "@/lib/user-profile";

const DEFAULT_USER_LIST_CACHE_TTL_MS = 30_000;
const DEFAULT_AVATAR_PROFILE_CACHE_TTL_MS = 10 * 60_000;
const LIST_USERS_PAGE_SIZE = 200;
const MAX_LIST_USERS_PAGES = 50;

type CachedUsers = {
  users: User[];
  expiresAtMs: number;
};

type CachedAvatarProfile = {
  avatarUrl: string | null;
  avatarBorderColor: string | null;
  expiresAtMs: number;
};

export type AdminAvatarProfile = {
  avatarUrl: string | null;
  avatarBorderColor: string | null;
};

let cachedUsers: CachedUsers | null = null;
let inFlightUsersPromise: Promise<User[]> | null = null;
const avatarProfileByUserIdCache = new Map<string, CachedAvatarProfile>();
const inFlightAvatarProfileByUserId = new Map<string, Promise<AdminAvatarProfile>>();

const cloneUsers = (users: User[]): User[] => [...users];

const fetchAllUsersFromAdminApi = async (): Promise<User[]> => {
  const supabase = getSupabaseServerClient();
  const users: User[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) {
      throw new Error(`Unable to list registered users: ${error.message}`);
    }

    users.push(...data.users);
    if (data.users.length < LIST_USERS_PAGE_SIZE || page >= MAX_LIST_USERS_PAGES) {
      break;
    }
    page += 1;
  }

  return users;
};

export const listAdminAuthUsersCached = async ({
  ttlMs = DEFAULT_USER_LIST_CACHE_TTL_MS,
}: {
  ttlMs?: number;
} = {}): Promise<User[]> => {
  const nowMs = Date.now();
  if (cachedUsers && cachedUsers.expiresAtMs > nowMs) {
    return cloneUsers(cachedUsers.users);
  }

  if (!inFlightUsersPromise) {
    inFlightUsersPromise = (async () => {
      const fetchedUsers = await fetchAllUsersFromAdminApi();
      cachedUsers = {
        users: fetchedUsers,
        expiresAtMs: Date.now() + Math.max(1_000, ttlMs),
      };
      return fetchedUsers;
    })().finally(() => {
      inFlightUsersPromise = null;
    });
  }

  const users = await inFlightUsersPromise;
  return cloneUsers(users);
};

const toAvatarProfile = ({
  user,
  supabaseUrl,
}: {
  user: User | null;
  supabaseUrl: string;
}): AdminAvatarProfile => ({
  avatarUrl: getUserAvatarUrl({ user, supabaseUrl }),
  avatarBorderColor: getUserAvatarBorderColor(user),
});

export const resolveAdminAvatarProfiles = async ({
  userIds,
  ttlMs = DEFAULT_AVATAR_PROFILE_CACHE_TTL_MS,
}: {
  userIds: string[];
  ttlMs?: number;
}): Promise<Map<string, AdminAvatarProfile>> => {
  const uniqueUserIds = [
    ...new Set(userIds.map((userId) => userId.trim()).filter((userId) => userId.length > 0)),
  ];
  const resolved = new Map<string, AdminAvatarProfile>();
  if (uniqueUserIds.length === 0) {
    return resolved;
  }

  const nowMs = Date.now();
  const pendingUserIds = new Set<string>();
  for (const userId of uniqueUserIds) {
    const cached = avatarProfileByUserIdCache.get(userId);
    if (cached && cached.expiresAtMs > nowMs) {
      resolved.set(userId, {
        avatarUrl: cached.avatarUrl,
        avatarBorderColor: cached.avatarBorderColor,
      });
      continue;
    }
    pendingUserIds.add(userId);
  }

  if (pendingUserIds.size === 0) {
    return resolved;
  }

  const cachedUserList = cachedUsers && cachedUsers.expiresAtMs > nowMs
    ? cachedUsers.users
    : null;
  if (cachedUserList) {
    const { supabaseUrl } = getSupabaseAuthEnv();
    for (const user of cachedUserList) {
      if (!pendingUserIds.has(user.id)) {
        continue;
      }
      const profile = toAvatarProfile({ user, supabaseUrl });
      avatarProfileByUserIdCache.set(user.id, {
        ...profile,
        expiresAtMs: nowMs + Math.max(1_000, ttlMs),
      });
      resolved.set(user.id, profile);
      pendingUserIds.delete(user.id);
    }
  }

  if (pendingUserIds.size === 0) {
    return resolved;
  }

  const supabase = getSupabaseServerClient();
  const { supabaseUrl } = getSupabaseAuthEnv();

  await Promise.all(
    [...pendingUserIds].map(async (userId) => {
      const inFlight = inFlightAvatarProfileByUserId.get(userId);
      if (inFlight) {
        const profile = await inFlight;
        resolved.set(userId, profile);
        return;
      }

      const profilePromise = (async (): Promise<AdminAvatarProfile> => {
        try {
          const { data, error } = await supabase.auth.admin.getUserById(userId);
          if (error || !data.user) {
            return {
              avatarUrl: null,
              avatarBorderColor: null,
            };
          }
          return toAvatarProfile({
            user: data.user,
            supabaseUrl,
          });
        } catch {
          return {
            avatarUrl: null,
            avatarBorderColor: null,
          };
        }
      })().finally(() => {
        inFlightAvatarProfileByUserId.delete(userId);
      });

      inFlightAvatarProfileByUserId.set(userId, profilePromise);
      const profile = await profilePromise;
      avatarProfileByUserIdCache.set(userId, {
        ...profile,
        expiresAtMs: Date.now() + Math.max(1_000, ttlMs),
      });
      resolved.set(userId, profile);
    }),
  );

  return resolved;
};
