import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CarryMate | AI 팀 프로젝트 협업 플랫폼",
  description: "대학생 팀 프로젝트의 일정, 업무, 회의, 자료를 AI와 함께 관리하는 협업 플랫폼",
  icons: {
    icon: "/brand/carrymate-symbol.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
