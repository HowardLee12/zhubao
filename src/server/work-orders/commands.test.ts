import { describe, expect, it } from "vitest";

import { deriveTransitionFacts, NOT_SENT_NOTIFICATION, type WorkOrderDetail } from "./commands";

const detail: WorkOrderDetail = {
  status: "on_site",
  lockVersion: 5,
  scheduledStartAt: "2026-08-01T01:00:00+00:00",
  scheduledEndAt: "2026-08-01T03:00:00+00:00",
  completionSummary: "已完工",
  completedAt: null,
  requiresCustomerSignoff: false,
  customerSignedAt: null,
  assignments: [
    { membershipId: "m1", status: "accepted" },
    { membershipId: "m2", status: "cancelled" },
  ],
  checklists: [
    {
      items: [
        { id: "i1", isRequired: true, evidenceRequired: false, response: true },
        { id: "i2", isRequired: true, evidenceRequired: true, response: null },
      ],
    },
  ],
  photos: [
    { category: "before", status: "ready" },
    { category: "after", status: "pending" },
  ],
};

describe("deriveTransitionFacts", () => {
  it("counts only active assignments", () => {
    expect(deriveTransitionFacts(detail).activeAssignmentCount).toBe(1);
  });

  it("flags an unanswered required checklist item as incomplete", () => {
    expect(deriveTransitionFacts(detail).requiredChecklistComplete).toBe(false);
  });

  it("reports ready before but not pending after as present/absent", () => {
    const facts = deriveTransitionFacts(detail);
    expect(facts.hasBeforePhoto).toBe(true);
    expect(facts.hasAfterPhoto).toBe(false);
  });
});

describe("NOT_SENT_NOTIFICATION", () => {
  it("declares deferral to M6", () => {
    expect(NOT_SENT_NOTIFICATION).toEqual({
      status: "not_sent",
      reason: "line_delivery_deferred_to_m6",
    });
  });
});
