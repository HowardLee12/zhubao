import { notFound } from "next/navigation";

export default function LegacyAuthenticatedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): never {
  void children;
  notFound();
}
