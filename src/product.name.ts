/**
 * The product's display name on its own, safe for client components.
 * product.config.ts imports database tables for its navigation, so anything
 * rendered in the browser (the logo) must not import it.
 */
export const PRODUCT_NAME = "Manifest"
