import {
  ArrowLeftRight,
  Boxes,
  CalendarCheck,
  ClipboardList,
  FileUp,
  MapPin,
  Package,
  Settings2,
  SlidersHorizontal,
  Tags,
  Truck,
  type LucideProps,
} from "lucide-react"
import type { IconName } from "@/lib/product"

const ICONS: Record<IconName, React.ComponentType<LucideProps>> = {
  today: CalendarCheck,
  stock: Boxes,
  moves: ArrowLeftRight,
  adjust: SlidersHorizontal,
  items: Package,
  orders: ClipboardList,
  locations: MapPin,
  suppliers: Truck,
  prices: Tags,
  import: FileUp,
  settings: Settings2,
}

/** One restrained icon set: 16px, 1.5 stroke, inheriting the text color. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const C = ICONS[name]
  return <C className={`size-4 shrink-0 ${className}`} strokeWidth={1.5} aria-hidden />
}
