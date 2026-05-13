import { getAllQuotesWithProjects } from "@/lib/queries";
import { TopBar } from "@/components/ui/top-bar";
import { Pill } from "@/components/ui/pill";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface QuoteVersion {
  id: string;
  version: number;
  created_at: string;
}

interface ProjectGroup {
  projectId: string;
  customerName: string;
  address: string;
  versions: QuoteVersion[];
}

export default async function QuotesListPage() {
  const quotes = await getAllQuotesWithProjects();

  // Group by project, keep all versions sorted desc
  const projectMap = new Map<string, ProjectGroup>();

  for (const quote of quotes) {
    const key = quote.project_id;
    const versionEntry: QuoteVersion = {
      id: quote.id,
      version: quote.version,
      created_at: quote.created_at,
    };
    const existing = projectMap.get(key);
    if (existing) {
      projectMap.set(key, {
        ...existing,
        versions: [...existing.versions, versionEntry],
      });
    } else {
      projectMap.set(key, {
        projectId: key,
        customerName: quote.project?.customer_name ?? "未知",
        address: quote.project?.address ?? "",
        versions: [versionEntry],
      });
    }
  }

  const grouped = Array.from(projectMap.values()).map((group) => ({
    ...group,
    versions: [...group.versions].sort((a, b) => b.version - a.version),
  }));

  return (
    <div className="pb-24">
      <TopBar
        title="報價單"
        subtitle={`${quotes.length} 份報價`}
      />

      {grouped.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-bg-warm border border-warm-border flex items-center justify-center">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-3"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="text-sm text-ink-2 mb-1">還沒有報價單</div>
          <Link
            href="/dashboard"
            className="inline-block mt-2 text-xs text-orange font-semibold"
          >
            前往案件列表建立報價 →
          </Link>
        </div>
      ) : (
        <div className="space-y-2 px-1">
          {grouped.map((group) => {
            const latest = group.versions[0];
            return (
              <div
                key={group.projectId}
                className="mx-3 bg-surface rounded-2xl border border-warm-border overflow-hidden"
              >
                <Link
                  href={`/quotes/${latest.id}`}
                  className="block p-4 active:scale-[0.99] transition-transform"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px] text-ink truncate">
                        {group.customerName}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-0.5 truncate font-mono">
                        {group.address}
                      </div>
                      <div className="text-[11px] text-ink-3 mt-1 font-mono">
                        最新 v{latest.version} ·{" "}
                        {new Date(latest.created_at).toLocaleDateString("zh-TW")}
                      </div>
                    </div>
                    <Pill variant="orange">{group.versions.length} 版</Pill>
                  </div>
                </Link>

                {group.versions.length > 1 && (
                  <div className="px-4 pb-3 flex gap-1.5 overflow-x-auto">
                    {group.versions.map((v) => (
                      <Link
                        key={v.id}
                        href={`/quotes/${v.id}`}
                        className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-bg-warm text-ink-2 font-mono font-medium hover:bg-orange-soft hover:text-orange-deep transition-colors"
                      >
                        v{v.version}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
