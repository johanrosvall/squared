"use client";

import React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "cc" | "shared" | "partner" | "income" | "transfer" | "danger";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-sq-gray-100 text-sq-gray-600 border-sq-gray-400",
  cc: "bg-blue-50 text-sq-blue border-sq-blue",
  shared: "bg-amber-50 text-amber-700 border-amber-400",
  partner: "bg-purple-50 text-sq-purple border-sq-purple",
  income: "bg-green-50 text-sq-green border-sq-green",
  transfer: "bg-sq-gray-100 text-sq-gray-600 border-sq-gray-400",
  danger: "bg-red-50 text-sq-red border-sq-red",
};

export function Badge({ variant = "default", children, className, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 border font-sans font-semibold text-[10px] uppercase tracking-wider",
        variantStyles[variant],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
