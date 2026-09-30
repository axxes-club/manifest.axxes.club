import { PRODUCT_NAME } from "@/product.name"
import { schema as s } from "@/lib/db"
import { defineProduct } from "@/lib/product"

export const product = defineProduct({
  name: PRODUCT_NAME,
  tagline: "Inventory operations on one honest ledger. Every number explains itself.",
  accent: "#c8ff3d",
  nav: [
    { title: null, items: [{ href: "/", label: "Today", icon: "today", chord: "t" }] },
    {
      title: "Stock",
      items: [
        { href: "/stock", label: "Stock", icon: "stock", chord: "s" },
        { href: "/moves", label: "Moves", icon: "moves", chord: "m" },
        { href: "/adjustments", label: "Adjustments", icon: "adjust", chord: "a" },
        { href: "/items", label: "Items", icon: "items", chord: "i" },
      ],
    },
    {
      title: "Buy",
      items: [
        { href: "/purchase-orders", label: "Purchase orders", icon: "orders", chord: "o", permission: "purchasing.view" },
        { href: "/suppliers", label: "Suppliers", icon: "suppliers", chord: "u" },
      ],
    },
    {
      title: "Sell",
      items: [{ href: "/price-lists", label: "Price lists", icon: "prices", chord: "p" }],
    },
    {
      title: "Setup",
      items: [
        { href: "/locations", label: "Locations", icon: "locations", chord: "l" },
        { href: "/import", label: "Import", icon: "import", permission: "import.run" },
        { href: "/settings", label: "Settings", icon: "settings", chord: "," },
      ],
    },
  ],
  resources: [
    {
      key: "suppliers",
      label: "Suppliers",
      singular: "Supplier",
      section: "Buy",
      icon: "suppliers",
      description: "Who you buy from, their terms and lead times.",
      table: s.suppliers,
      list: ["name", "email", "phone", "leadTimeDays", "isActive"],
      form: ["name", "email", "phone", "website", "paymentTerms", "leadTimeDays", "currency", "addressLine1", "city", "state", "country", "isActive", "notes"],
    },
    {
      key: "price-lists",
      label: "Price lists",
      singular: "Price list",
      section: "Sell",
      icon: "prices",
      description: "Tiered pricing for wholesale, VIP and distributor customers.",
      table: s.priceLists,
      list: ["name", "pricingTier", "markupPercentage", "discountPercentage", "isActive"],
      form: ["name", "description", "pricingTier", "currency", "markupPercentage", "discountPercentage", "validFrom", "validUntil", "isActive", "isDefault"],
    },
  ],
})

export const allNavItems = product.nav.flatMap((s) => s.items)
