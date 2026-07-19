import type { Dispatch } from "react";

import type { DemoAction, DemoState } from "@/lib/v2-demo/types";

export interface DemoScreenProps {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
}

