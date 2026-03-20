"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({
  label,
  error,
  className,
  ...props
}: InputProps) {
  return (
    <div className="mb-6">
      {label && (
        <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
          {label}
        </label>
      )}
      <input
        className={cn(
          "w-full bg-sq-white border-2 border-sq-black px-4 py-3 font-sans text-[15px] text-sq-black placeholder:text-sq-gray-400 outline-none focus:border-sq-blue transition-colors",
          error && "border-sq-red",
          className
        )}
        {...props}
      />
      {error && (
        <p className="mt-1 font-sans text-[12px] text-sq-red">{error}</p>
      )}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <div className="mb-6">
      {label && (
        <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
          {label}
        </label>
      )}
      <select
        className={cn(
          "w-full bg-sq-white border-2 border-sq-black px-4 py-3 font-sans text-[15px] text-sq-black outline-none focus:border-sq-blue transition-colors",
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
