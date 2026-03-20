"use client";

import React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-sq-black text-sq-white hover:bg-[#333333] border-2 border-sq-black",
  secondary:
    "bg-sq-white text-sq-black border-2 border-sq-black hover:bg-sq-black hover:text-sq-white",
  danger:
    "bg-sq-red text-sq-white border-2 border-sq-red hover:bg-[#B3002F]",
  ghost:
    "text-sq-gray-600 hover:text-sq-black border-2 border-transparent",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-[11px]",
  md: "px-6 py-3 text-[13px]",
  lg: "px-8 py-4 text-[14px]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "font-sans font-bold uppercase tracking-widest transition-colors inline-flex items-center justify-center gap-2",
        variantStyles[variant],
        sizeStyles[size],
        props.disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
