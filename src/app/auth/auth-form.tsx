"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Input } from "@heroui/input";
import { Tab, Tabs } from "@heroui/tabs";
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
      <CardHeader className="flex flex-col items-start gap-2">
        <h1 className="text-2xl font-semibold">Friends League Access</h1>
        <p className="text-sm text-default-500">
          Sign in or create an account to view the private fantasy dashboard.
        </p>
      </CardHeader>
      <CardBody className="gap-4">
        <Tabs
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
          className="flex flex-col gap-3"
          onSubmit={mode === "login" ? handleLogin : handleRegister}
        >
          <Input
            isRequired
            autoComplete="email"
            inputMode="email"
            label="Email"
            labelPlacement="outside"
            type="email"
            value={email}
            onValueChange={setEmail}
          />
          <Input
            isRequired
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            label="Password"
            labelPlacement="outside"
            type="password"
            value={password}
            onValueChange={setPassword}
          />
          {mode === "register" ? (
            <Input
              isRequired
              autoComplete="given-name"
              label="First Name"
              labelPlacement="outside"
              placeholder="James"
              value={firstName}
              onValueChange={setFirstName}
            />
          ) : null}
          {mode === "register" ? (
            <Input
              isRequired
              autoComplete="family-name"
              label="Last Name"
              labelPlacement="outside"
              placeholder="Shaw"
              value={lastName}
              onValueChange={setLastName}
            />
          ) : null}
          {mode === "register" ? (
            <Input
              isRequired
              autoComplete="organization"
              label="Team Name"
              labelPlacement="outside"
              placeholder="Cloud9"
              value={teamName}
              onValueChange={setTeamName}
            />
          ) : null}
          {mode === "register" ? (
            <Input
              isRequired
              autoComplete="new-password"
              label="Confirm Password"
              labelPlacement="outside"
              type="password"
              value={confirmPassword}
              onValueChange={setConfirmPassword}
            />
          ) : null}

          {error ? <p className="text-sm text-danger-400">{error}</p> : null}
          {message ? <p className="text-sm text-success-400">{message}</p> : null}

          <Button
            className="w-full"
            color="primary"
            isLoading={pending}
            size="lg"
            type="submit"
          >
            {mode === "login" ? "Login" : "Create Account"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
};
