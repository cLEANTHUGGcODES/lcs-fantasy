import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isRecoverableSupabaseAuthError,
  isSupabaseAuthCookieName,
} from "@/lib/supabase-auth-errors";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const publicApiKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !publicApiKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, publicApiKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const clearSupabaseAuthCookies = () => {
    const cookieNames = request.cookies
      .getAll()
      .map(({ name }) => name)
      .filter(isSupabaseAuthCookieName);

    if (cookieNames.length === 0) {
      return;
    }

    response = NextResponse.next({
      request,
    });

    cookieNames.forEach((name) => {
      request.cookies.set(name, "");
      response.cookies.set(name, "", {
        path: "/",
        expires: new Date(0),
        maxAge: 0,
      });
    });
  };

  try {
    const { error } = await supabase.auth.getUser();
    if (error && isRecoverableSupabaseAuthError(error)) {
      clearSupabaseAuthCookies();
    }
  } catch (error) {
    if (isRecoverableSupabaseAuthError(error)) {
      clearSupabaseAuthCookies();
    } else {
      throw error;
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
