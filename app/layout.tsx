import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Squared — Personal Financial Reconciliation",
  description:
    "Personal financial reconciliation made accurate. Import CSV bank statements, reconcile credit card bills, and track shared expenses with your partner.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
