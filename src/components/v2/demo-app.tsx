"use client";

import { useReducer } from "react";

import { createInitialDemoState, demoReducer } from "@/lib/v2-demo/store";

import { CaseScreen } from "./case-screen";
import { CompleteScreen } from "./complete-screen";
import { DemoShell } from "./demo-shell";
import { DispatchScreen } from "./dispatch-screen";
import { FieldScreen } from "./field-screen";
import { InboxScreen } from "./inbox-screen";
import {
  DemoEmptyState,
  DemoErrorState,
  DemoNotice,
  DemoSkeleton,
} from "./primitives";
import { QuoteScreen } from "./quote-screen";

export function DemoApp() {
  const [state, dispatch] = useReducer(demoReducer, undefined, () =>
    createInitialDemoState("service"),
  );

  let content;

  if (state.viewState === "loading") {
    content = <DemoSkeleton />;
  } else if (state.viewState === "empty") {
    content = (
      <DemoEmptyState
        onRestore={() => dispatch({ type: "SET_VIEW_STATE", viewState: "ready" })}
      />
    );
  } else if (state.viewState === "error") {
    content = (
      <DemoErrorState
        onRetry={() => dispatch({ type: "SET_VIEW_STATE", viewState: "ready" })}
      />
    );
  } else {
    const screens = {
      inbox: <InboxScreen state={state} dispatch={dispatch} />,
      case: <CaseScreen state={state} dispatch={dispatch} />,
      quote: <QuoteScreen state={state} dispatch={dispatch} />,
      dispatch: <DispatchScreen state={state} dispatch={dispatch} />,
      field: <FieldScreen state={state} dispatch={dispatch} />,
      complete: <CompleteScreen state={state} dispatch={dispatch} />,
    };
    content = screens[state.currentStep];
  }

  return (
    <DemoShell state={state} dispatch={dispatch}>
      {state.notice && state.viewState === "ready" ? (
        <div className="mb-4">
          <DemoNotice notice={state.notice} />
        </div>
      ) : null}
      {content}
    </DemoShell>
  );
}

