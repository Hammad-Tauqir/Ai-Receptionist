import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova Digital — AI Voice Receptionist",
  description: "A conversation is a great place to start. Explore Nova Digital’s web, marketing, SEO and AI automation services with Nova, our AI receptionist.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
