"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-sq-black/40"
        onClick={onClose}
      />
      {/* Modal content */}
      <div
        className={cn(
          "relative bg-sq-white border-2 border-sq-black w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4",
          className
        )}
      >
        <div className="flex items-center justify-between p-6 border-b-2 border-sq-black">
          <h2 className="font-sans font-extrabold text-[20px] uppercase tracking-tight text-sq-black">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-sq-gray-600 hover:text-sq-black transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
