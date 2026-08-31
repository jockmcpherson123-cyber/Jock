import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

export const metadata = {
  title: "Grounds Operations — Congressional Country Club",
  description:
    "Digital spray sheets, chemical library, inventory and agronomic intelligence for golf course grounds management.",
  applicationName: "Grounds Operations",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Grounds",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
};

// Keep the app comfortable on iPads in the field: lock the zoom behaviour and
// respect device safe areas. theme_color paints the standalone status bar.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16291F",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-body">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
