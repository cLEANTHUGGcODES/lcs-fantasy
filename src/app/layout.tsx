import type { Metadata } from "next";
import { League_Spartan } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const leagueSpartan = League_Spartan({
  variable: "--font-league-spartan",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LCS Friends Fantasy",
  description:
    "Lightweight fantasy dashboard powered by Leaguepedia scoreboard data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={leagueSpartan.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
