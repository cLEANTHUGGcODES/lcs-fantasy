"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Input } from "@heroui/input";
import { Tab, Tabs } from "@heroui/tabs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { normalizePersonName, normalizeTeamName } from "@/lib/user-profile";

type AuthMode = "login" | "register";

export const AuthForm = ({ nextPath }: { nextPath: string }) => {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldGapClass = mode === "login" ? "gap-1.5" : "gap-2";
  const tightInputClassNames = { base: "gap-1" } as const;

  const finishSignedIn = () => {
    router.replace(nextPath);
    router.refresh();
  };

  const resetNotices = () => {
    setMessage(null);
    setError(null);
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetNotices();
    setPending(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setPending(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    finishSignedIn();
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetNotices();

    const normalizedFirstName = normalizePersonName(firstName);
    const normalizedLastName = normalizePersonName(lastName);
    const normalizedTeamName = normalizeTeamName(teamName);
    if (!normalizedFirstName) {
      setError("First name is required.");
      return;
    }
    if (!normalizedLastName) {
      setError("Last name is required.");
      return;
    }
    if (!normalizedTeamName) {
      setError("Team name is required.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    const emailRedirectTo = `${window.location.origin}${nextPath}`;
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo,
        data: {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          team_name: normalizedTeamName,
          display_name: `${normalizedFirstName} ${normalizedLastName}`,
          full_name: `${normalizedFirstName} ${normalizedLastName}`,
        },
      },
    });

    setPending(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      finishSignedIn();
      return;
    }

    setMessage(
      "Registration succeeded. Check your email to confirm your account before logging in.",
    );
  };

  return (
    <Card className="w-full max-w-md border border-default-200/40 bg-content1/80 backdrop-blur-xl">
      <CardHeader className="flex flex-col gap-3 px-5 pb-2 pt-5 sm:px-6">
        <div className="flex w-full justify-center">
          <Image
            src="/img/insight-lol-fantasy-logo.png"
            alt="Insight LoL Fantasy"
            width={900}
            height={170}
            priority
            className="h-auto w-full max-w-[180px]"
          />
        </div>
        <span
          aria-hidden
          className="block h-px w-full bg-gradient-to-r from-transparent via-default-300/45 to-transparent"
        />
      </CardHeader>
      <CardBody className="px-5 pb-5 pt-2 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-4">
        <Tabs
          className="w-full"
          aria-label="Authentication mode"
          color="primary"
          selectedKey={mode}
          variant="underlined"
          onSelectionChange={(key) => {
            setMode(key as AuthMode);
            resetNotices();
          }}
        >
          <Tab key="login" title="Login" />
          <Tab key="register" title="Register" />
        </Tabs>

        <form
          className="flex flex-col"
          onSubmit={mode === "login" ? handleLogin : handleRegister}
        >
          <div className={`flex flex-col ${fieldGapClass}`}>
            {mode === "register" ? (
              <>
                <Input
                  isRequired
                  autoComplete="given-name"
                  classNames={tightInputClassNames}
                  label="First Name"
                  labelPlacement="outside"
                  value={firstName}
                  onValueChange={setFirstName}
                />
                <Input
                  isRequired
                  autoComplete="family-name"
                  classNames={tightInputClassNames}
                  label="Last Name"
                  labelPlacement="outside"
                  value={lastName}
                  onValueChange={setLastName}
                />
                <Input
                  isRequired
                  autoComplete="email"
                  inputMode="email"
                  classNames={tightInputClassNames}
                  label="Email"
                  labelPlacement="outside"
                  type="email"
                  value={email}
                  onValueChange={setEmail}
                />
                <Input
                  isRequired
                  autoComplete="organization"
                  classNames={tightInputClassNames}
                  label="Team Name"
                  labelPlacement="outside"
                  value={teamName}
                  onValueChange={setTeamName}
                />
                <Input
                  isRequired
                  autoComplete="new-password"
                  classNames={tightInputClassNames}
                  label="Password"
                  labelPlacement="outside"
                  type="password"
                  value={password}
                  onValueChange={setPassword}
                />
                <Input
                  isRequired
                  autoComplete="new-password"
                  classNames={tightInputClassNames}
                  label="Confirm Password"
                  labelPlacement="outside"
                  type="password"
                  value={confirmPassword}
                  onValueChange={setConfirmPassword}
                />
              </>
            ) : (
              <>
                <Input
                  isRequired
                  autoComplete="email"
                  inputMode="email"
                  classNames={tightInputClassNames}
                  label="Email"
                  labelPlacement="outside"
                  type="email"
                  value={email}
                  onValueChange={setEmail}
                />
                <Input
                  isRequired
                  autoComplete="current-password"
                  classNames={tightInputClassNames}
                  label="Password"
                  labelPlacement="outside"
                  type="password"
                  value={password}
                  onValueChange={setPassword}
                />
              </>
            )}
          </div>

          {error ? <p className="mt-3 text-sm leading-5 text-danger-400">{error}</p> : null}
          {message ? <p className="mt-3 text-sm leading-5 text-success-400">{message}</p> : null}

          <Button
            className="mt-6 w-full"
            color="primary"
            isLoading={pending}
            size="lg"
            type="submit"
          >
            {mode === "login" ? "Login" : "Create Account"}
          </Button>
        </form>
        </div>
      </CardBody>
    </Card>
  );
};
