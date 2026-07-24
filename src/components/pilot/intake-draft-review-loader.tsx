"use client";

import { PilotIntakeDraftReview } from "./intake-draft-review";

/**
 * Thin client boundary for the LINE intake-draft review screen. The page is a
 * server component that only knows the draft id from the route; this loader is the
 * "use client" seam that hands off to {@link PilotIntakeDraftReview}, which owns
 * session resolution, the role gate, and the confirm/dismiss workflow. Keeping the
 * boundary here mirrors {@link PilotRequestDetailLoader} so the page stays a pure
 * server component and the workflow component is independently testable.
 */
export function PilotIntakeDraftReviewLoader({ draftId }: Readonly<{ draftId: string }>) {
  return <PilotIntakeDraftReview draftId={draftId} />;
}
