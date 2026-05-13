import Link from "next/link";
import { getCrews } from "@/lib/queries";
import { CrewManager } from "@/components/crew-manager";
import { TopBar } from "@/components/ui/top-bar";

export const dynamic = "force-dynamic";

export default async function CrewsPage() {
  const crews = await getCrews();

  return (
    <div className="pb-24">
      <TopBar
        title="工班通訊錄"
        subtitle={`${crews.length} 位工班`}
        back={
          <Link
            href="/account"
            aria-label="返回帳號"
            className="w-9 h-9 rounded-xl border border-warm-border bg-surface flex items-center justify-center text-ink-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        }
      />

      <CrewManager initialCrews={crews} />
    </div>
  );
}
