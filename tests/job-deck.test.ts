import { describe, expect, it, vi } from "vitest"

import { isInteractiveSwipeTarget } from "@/components/jobs/job-deck"

describe("job deck swipe controls", () => {
  it("does not capture pointer gestures started from an interactive control", () => {
    const closest = vi.fn().mockReturnValue({})

    expect(isInteractiveSwipeTarget({ closest } as unknown as EventTarget)).toBe(true)
    expect(closest).toHaveBeenCalledWith("button,a,input,select,textarea")
  })

  it("keeps card background gestures swipeable", () => {
    expect(isInteractiveSwipeTarget({ closest: () => null } as unknown as EventTarget)).toBe(false)
  })
})
