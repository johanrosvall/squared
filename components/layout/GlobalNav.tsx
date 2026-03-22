"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Transactions", href: "/transactions" },
  { label: "Analytics", href: "/analytics" },
  { label: "Subscriptions", href: "/subscriptions" },
  { label: "Categorize", href: "/categorize" },
];

interface GlobalNavProps {
  userName?: string;
}

export function GlobalNav({ userName = "" }: GlobalNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = userName
    ? userName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth");
  };

  return (
    <header className="h-16 border-b-2 border-sq-black flex items-center justify-between px-6 bg-sq-white shrink-0">
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-10">
        <Link
          href="/dashboard"
          className="font-sans font-extrabold text-2xl tracking-tight text-sq-black"
        >
          SQUARED
        </Link>
        <nav className="flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "font-sans font-semibold text-[12px] uppercase tracking-[0.08em] pb-1 transition-colors",
                  isActive
                    ? "border-b-2 border-sq-black text-sq-black"
                    : "text-sq-gray-600 hover:text-sq-black"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: Import + Avatar */}
      <div className="flex items-center gap-6">
        {/* Import CSV button */}
        <Link
          href="/import"
          className="font-sans font-semibold text-[12px] uppercase tracking-wider bg-sq-black text-sq-white px-4 py-2 hover:bg-[#333333] transition-colors"
        >
          Import CSV
        </Link>

        {/* User avatar dropdown */}
        <div className="relative group">
          <div className="w-8 h-8 bg-sq-gray-100 border border-sq-black flex items-center justify-center cursor-pointer">
            <span className="font-sans font-bold text-[12px] text-sq-black">
              {initials}
            </span>
          </div>
          {/* Simple dropdown */}
          <div className="absolute right-0 top-full mt-1 bg-sq-white border-2 border-sq-black hidden group-hover:block z-50 min-w-[160px]">
            <Link
              href="/settings"
              className="block px-4 py-3 font-sans text-[12px] uppercase tracking-wider font-semibold hover:bg-sq-gray-100 transition-colors"
            >
              Settings
            </Link>
            <Link
              href="/accounts"
              className="block px-4 py-3 font-sans text-[12px] uppercase tracking-wider font-semibold hover:bg-sq-gray-100 transition-colors"
            >
              Accounts
            </Link>
            <button
              onClick={handleLogout}
              className="block w-full text-left px-4 py-3 font-sans text-[12px] uppercase tracking-wider font-semibold text-sq-red hover:bg-red-50 transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
