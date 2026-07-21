import "./globals.css";

export const metadata = {
  title: "Grounds Operations — Congressional Country Club",
  description:
    "Digital spray sheets, chemical library, inventory and agronomic intelligence for golf course grounds management.",
};

// Keep the app comfortable on iPads in the field: lock the zoom behaviour and
// respect device safe areas.
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-body">{children}</body>
    </html>
  );
}
