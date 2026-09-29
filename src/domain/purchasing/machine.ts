import { machine } from "../machine"

export type PoStatus = "draft" | "approved" | "sent" | "partially_received" | "received" | "closed" | "cancelled"
export type PoEvent = "approve" | "place" | "send" | "cancel" | "close" | "receive_some" | "receive_all" | "unreceive_some" | "unreceive_all"

/**
 * Purchase order lifecycle. "place" is approve-and-send in one step, for orders
 * under the approval threshold or placed by someone who can approve. Receiving
 * events are raised by receipts, never by a button.
 */
export const poMachine = machine<PoStatus, PoEvent>("purchase order", {
  draft: { approve: "approved", place: "sent", cancel: "cancelled" },
  approved: { send: "sent", cancel: "cancelled", receive_some: "partially_received", receive_all: "received" },
  sent: { receive_some: "partially_received", receive_all: "received", cancel: "cancelled" },
  partially_received: { receive_some: "partially_received", receive_all: "received", unreceive_some: "partially_received", unreceive_all: "sent", close: "closed" },
  received: { unreceive_some: "partially_received", unreceive_all: "sent", close: "closed" },
  closed: {},
  cancelled: {},
})

/** Events a person can trigger from the order screen (receiving has its own screen). */
export const PO_USER_EVENTS: PoEvent[] = ["approve", "place", "send", "cancel", "close"]
export const PO_EDITABLE: PoStatus[] = ["draft", "approved", "sent", "partially_received"]
export const PO_RECEIVABLE: PoStatus[] = ["approved", "sent", "partially_received"]
