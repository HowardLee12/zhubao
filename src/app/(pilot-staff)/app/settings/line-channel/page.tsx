import type { Metadata } from "next";

import { LineChannelSettings } from "@/components/pilot/line-channel-settings";

export const metadata: Metadata = {
  title: "LINE 官方帳號｜Renoly",
};

export default function PilotLineChannelPage() {
  return <LineChannelSettings />;
}
