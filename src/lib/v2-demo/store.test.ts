import { beforeAll, describe, expect, it } from "vitest";

import {
  createInitialDemoState,
  demoReducer,
  getCaseStage,
  getConfirmedTotal,
  getMissingCompletionItems,
} from "./store";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeAll(() => {
  if (typeof window.localStorage.clear !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  }
  if (typeof window.sessionStorage.clear !== "function") {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  }
});

describe("v2 demo store", () => {
  it("requires an explicit human confirmation before sending a quote", () => {
    const initial = createInitialDemoState("service");
    const rejected = demoReducer(initial, { type: "APPROVE_QUOTE" });

    expect(rejected.quote.status).toBe("draft");
    expect(rejected.notice?.tone).toBe("danger");

    const confirmed = demoReducer(rejected, {
      type: "SET_QUOTE_CONFIRMED",
      value: true,
    });
    const sent = demoReducer(confirmed, { type: "APPROVE_QUOTE" });

    expect(sent.quote.status).toBe("sent");
    expect(sent.timeline.at(-1)?.title).toContain("報價");
  });

  it("blocks completion until checklist and required photos are present", () => {
    let state = createInitialDemoState("service");
    state = demoReducer(state, { type: "SCHEDULE_WORK_ORDER" });
    state = demoReducer(state, { type: "ADVANCE_WORK_ORDER" });
    state = demoReducer(state, { type: "ADVANCE_WORK_ORDER" });
    state = demoReducer(state, { type: "ADVANCE_WORK_ORDER" });
    state = demoReducer(state, { type: "ADVANCE_WORK_ORDER" });

    expect(getMissingCompletionItems(state)).toHaveLength(5);

    const blocked = demoReducer(state, { type: "COMPLETE_WORK_ORDER" });
    expect(blocked.workOrder.status).toBe("waiting_confirmation");
    expect(blocked.notice?.tone).toBe("danger");

    for (const item of blocked.checklist) {
      state = demoReducer(state, { type: "TOGGLE_CHECKLIST", id: item.id });
    }
    state = demoReducer(state, { type: "ADD_DEMO_PHOTO", kind: "before" });
    state = demoReducer(state, { type: "ADD_DEMO_PHOTO", kind: "after" });

    expect(getMissingCompletionItems(state)).toEqual([]);
    const completed = demoReducer(state, { type: "COMPLETE_WORK_ORDER" });
    expect(completed.workOrder.status).toBe("completed");
    expect(completed.currentStep).toBe("complete");
  });

  it("adds a project change order only after the customer accepts it", () => {
    let state = createInitialDemoState("project");

    expect(getConfirmedTotal(state)).toBe(68000);

    state = demoReducer(state, { type: "SEND_CHANGE_ORDER" });
    expect(state.changeOrder?.status).toBe("sent");
    expect(getConfirmedTotal(state)).toBe(68000);

    state = demoReducer(state, { type: "ACCEPT_CHANGE_ORDER" });
    expect(state.changeOrder?.status).toBe("accepted");
    expect(getConfirmedTotal(state)).toBe(76000);
  });

  it("resets the workflow with the fixture for the selected template", () => {
    const service = createInitialDemoState("service");
    const project = demoReducer(service, {
      type: "SWITCH_TEMPLATE",
      template: "project",
    });

    expect(project.template).toBe("project");
    expect(project.currentStep).toBe("inbox");
    expect(project.caseRecord.title).toContain("防水");
    expect(project.changeOrder).not.toBeNull();
  });

  it("keeps en-route work in the scheduled stage until the technician arrives", () => {
    const initial = createInitialDemoState("service");
    const scheduled = demoReducer(initial, { type: "SCHEDULE_WORK_ORDER" });
    const enRoute = demoReducer(scheduled, { type: "ADVANCE_WORK_ORDER" });
    const onSite = demoReducer(enRoute, { type: "ADVANCE_WORK_ORDER" });
    const inProgress = demoReducer(onSite, { type: "ADVANCE_WORK_ORDER" });

    expect(getCaseStage(scheduled)).toBe("已排程");
    expect(getCaseStage(enRoute)).toBe("已排程");
    expect(getCaseStage(onSite)).toBe("進行中");
    expect(getCaseStage(inProgress)).toBe("進行中");
  });
});
