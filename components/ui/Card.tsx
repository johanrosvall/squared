"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover = false, onClick }: CardProps) {
  return (
    <div
      className={cn(
        "border-2 border-sq-black bg-sq-white p-6",
        hover && "hover:shadow-lg transition-shadow cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
