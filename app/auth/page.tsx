"use client";

export const dynamic = "force-dynamic";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.user) {
      // Seed default categories for the new user
      await supabase.rpc("seed_default_categories", { p_user_id: data.user.id });
      router.push("/accounts");
    }
  };

  return (
    <div className="min-h-screen bg-sq-white font-sans text-sq-black flex flex-col items-center justify-center p-8">
      {/* Header / Logo */}
      <div className="mb-12 text-center">
        <h1 className="font-sans font-extrabold text-[56px] tracking-tighter text-sq-black uppercase leading-none mb-2">
          Squared
        </h1>
        <p className="font-sans text-[14px] text-sq-gray-600 font-medium tracking-wide uppercase">
          Personal Financial Reconciliation
        </p>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm">
        {error && (
          <div className="mb-6 border-2 border-sq-red bg-red-50 px-4 py-3 font-sans text-[13px] text-sq-red">
            {error}
          </div>
        )}

        {mode === "login" ? (
          <form onSubmit={handleLogin}>
            <Input
              label="Email Address"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sq-black text-sq-white font-sans font-bold text-[14px] uppercase tracking-widest py-4 hover:bg-[#333333] transition-colors disabled:opacity-50"
            >
              {loading ? "Logging in…" : "Log In"}
            </button>
            <div className="mt-6 text-center">
              <p className="font-sans text-[14px] text-sq-gray-600">
                New to Squared?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("signup"); setError(""); }}
                  className="font-semibold text-sq-black underline decoration-2 underline-offset-4 hover:text-sq-blue"
                >
                  Create Account
                </button>
              </p>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <Input
              label="Full Name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              label="Email Address"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sq-black text-sq-white font-sans font-bold text-[14px] uppercase tracking-widest py-4 hover:bg-[#333333] transition-colors disabled:opacity-50"
            >
              {loading ? "Creating Account…" : "Create Account"}
            </button>
            <div className="mt-6 text-center">
              <p className="font-sans text-[14px] text-sq-gray-600">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => { setMode("login"); setError(""); }}
                  className="font-semibold text-sq-black underline decoration-2 underline-offset-4 hover:text-sq-blue"
                >
                  Log In
                </button>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
