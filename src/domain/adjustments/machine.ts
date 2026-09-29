import { machine } from "../machine"

export type AdjustmentStatus = "draft" | "posted" | "cancelled"
export type AdjustmentEvent = "post" | "cancel"

export const adjustmentMachine = machine<AdjustmentStatus, AdjustmentEvent>("adjustment", {
  draft: { post: "posted", cancel: "cancelled" },
  posted: {},
  cancelled: {},
})
