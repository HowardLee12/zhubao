import { getUserProfile, getUserUsage, PLAN_LIMITS } from "@/lib/queries";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  free: "免費版",
  pro: "專業版",
};

export default async function AccountPage() {
  const [profile, usage] = await Promise.all([
    getUserProfile(),
    getUserUsage(),
  ]);

  if (!profile) redirect("/");

  const plan = profile.plan ?? "free";
  const quoteLimit = PLAN_LIMITS[plan]?.quotes ?? PLAN_LIMITS.free.quotes;
  const isFreePlan = plan === "free";

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="text-lg font-bold">帳號</div>
        <div className="text-xs opacity-80">管理你的帳號與方案</div>
      </header>

      {/* Profile */}
      <div className="p-4">
        <div className="bg-card rounded-xl shadow-sm p-4 flex items-center gap-4">
          {profile.picture_url ? (
            <img
              src={profile.picture_url}
              alt={profile.display_name}
              className="w-14 h-14 rounded-full object-cover"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-sage-200 flex items-center justify-center text-sage-600 text-xl font-bold">
              {profile.display_name?.charAt(0) || "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold truncate">{profile.display_name}</div>
            <div className="text-xs text-muted-foreground">LINE 帳號登入</div>
          </div>
        </div>
      </div>

      {/* Plan */}
      <div className="px-4 pb-4">
        <div className="text-sm font-semibold text-sage-800 mb-3">目前方案</div>
        <div className="bg-card rounded-xl shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <div>
              <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                isFreePlan
                  ? "bg-gray-100 text-gray-600"
                  : "bg-primary/10 text-primary"
              }`}>
                {PLAN_LABELS[plan] ?? plan}
              </span>
            </div>
          </div>

          {/* Usage stats */}
          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">報價單</span>
                <span className="font-medium">
                  {usage.quoteCount} / {quoteLimit === Infinity ? "無限" : quoteLimit}
                </span>
              </div>
              {isFreePlan && (
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      usage.quoteCount >= quoteLimit ? "bg-destructive" : "bg-primary"
                    }`}
                    style={{ width: `${Math.min((usage.quoteCount / quoteLimit) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">案件數</span>
              <span className="font-medium">{usage.projectCount} 個</span>
            </div>
          </div>
        </div>
      </div>

      {/* Upgrade CTA for free users */}
      {isFreePlan && (
        <div className="px-4 pb-4">
          <div className="bg-sage-50 border border-sage-200 rounded-xl p-4">
            <div className="text-sm font-bold text-sage-800 mb-1">升級專業版</div>
            <div className="text-xs text-sage-600 mb-3">
              無限報價單、無限案件，解鎖所有功能
            </div>
            <button
              disabled
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-semibold text-sm opacity-50 cursor-not-allowed"
            >
              即將推出
            </button>
          </div>
        </div>
      )}

      {/* Logout */}
      <div className="px-4 pb-4">
        <LogoutButton />
      </div>
    </div>
  );
}
