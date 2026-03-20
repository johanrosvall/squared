"use client";

import React from "react";
import { GlobalNav } from "./GlobalNav";

interface PageShellProps {
  children: React.ReactNode;
  userName?: string;
}

export function PageShell({ children, userName = "" }: PageShellProps) {
  return (
    <div className="min-h-screen bg-sq-white font-sans text-sq-black flex flex-col">
      <GlobalNav userName={userName} />
      <main className="flex-1 p-12 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
