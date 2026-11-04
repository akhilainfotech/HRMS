import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HRMS Attendance",
  description: "Role-based geotag attendance prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
