import { describe, expect, it } from "vitest"
import { parseVerb, verbHref, verbLabel } from "@/lib/verbs"

describe("command palette verbs", () => {
  it.each([
    ["move 12 TEE-1 to a-02", { kind: "move", qty: "12", sku: "TEE-1", to: "A-02", from: undefined }],
    ["mv 3 x CAP from A-01 → B-2", { kind: "move", qty: "3", sku: "CAP", from: "A-01", to: "B-2" }],
    ["add 5 MUG at A1", { kind: "adjust", qty: "5", sku: "MUG", at: "A1" }],
    ["remove 2 MUG", { kind: "adjust", qty: "-2", sku: "MUG", at: undefined }],
    ["adjust MUG -4 @ a1", { kind: "adjust", qty: "-4", sku: "MUG", at: "A1" }],
    ["set TEE-1 to 40 at A-01", { kind: "set", qty: "40", sku: "TEE-1", at: "A-01" }],
    ["where is logo tee", { kind: "find", query: "logo tee" }],
    ["receive PO-000012", { kind: "receive", po: "PO-000012" }],
    ["receive po 12", { kind: "receive", po: "PO-000012" }],
    ["order 50 CAP-01", { kind: "order", qty: "50", sku: "CAP-01" }],
    ["reorder CAP-01", { kind: "order", qty: undefined, sku: "CAP-01" }],
  ])("parses %s", (text, verb) => expect(parseVerb(text)).toEqual(verb))

  it("ignores plain searches", () => expect(parseVerb("black tee")).toBeNull())

  it("labels and links", () => {
    const v = parseVerb("move 12 TEE-1 to A-02")!
    expect(verbLabel(v)).toBe("Move 12 × TEE-1 → A-02")
    expect(verbHref(v)).toBe("/moves/new?sku=TEE-1&qty=12&to=A-02")
  })
})
