import { getAllQuotesWithProjects } from "@/lib/queries";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QuotesListPage() {
  const quotes = await getAllQuotesWithProjects();

  // Group by project, keep all versions sorted desc
  const projectMap = new Map<
    string,
    { customerName: string; address: string; projectId: string; versions: typeof quotes }
  >();

  for (const quote of quotes) {
    const key = quote.project_id;
    const existing = projectMap.get(key);
    if (existing) {
      projectMap.set(key, {
        ...existing,
        versions: [...existing.versions, quote],
      });
    } else {
      projectMap.set(key, {
        customerName: quote.project?.customer_name ?? "未知",
        address: quote.project?.address ?? "",
        projectId: key,
        versions: [quote],
      });
    }
  }

  // Sort versions within each project (desc by version)
  const grouped = Array.from(projectMap.values()).map((group) => ({
    ...group,
    versions: [...group.versions].sort((a, b) => b.version - a.version),
  }));

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-3">
        <div className="text-lg font-bold">報價單</div>
        <div className="text-xs opacity-80">{quotes.length} 份報價</div>
      </header>

      <div className="p-4 space-y-3">
        {grouped.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm">還沒有報價單</div>
            <Link href="/dashboard" className="text-xs mt-1 text-primary font-medium block">
              前往案件列表建立報價單
            </Link>
          </div>
        )}

        {grouped.map((group) => {
          const latest = group.versions[0];
          return (
            <div key={group.projectId} className="bg-card rounded-xl shadow-sm overflow-hidden">
              <Link href={`/quotes/${latest.id}`}>
                <div className="p-4 active:scale-[0.98] transition-transform">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-[15px]">
                        {group.customerName} — {group.address}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        最新 v{latest.version} · {new Date(latest.created_at).toLocaleDateString("zh-TW")}
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-sage-100 text-sage-700 font-medium">
                      {group.versions.length} 個版本
                    </span>
                  </div>
                </div>
              </Link>

              {group.versions.length > 1 && (
                <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
                  {group.versions.map((v) => (
                    <Link
                      key={v.id}
                      href={`/quotes/${v.id}`}
                      className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-sage-50 text-sage-600 font-medium hover:bg-sage-100 transition-colors"
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
    </div>
  );
}
