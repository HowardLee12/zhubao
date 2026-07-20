import { reportFunnel } from "@/server/reporting/gateway";
import { makeReportRoute } from "@/server/reporting/report-route";

export const dynamic = "force-dynamic";

export const GET = makeReportRoute(reportFunnel);
