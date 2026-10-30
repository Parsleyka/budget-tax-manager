/** Settings tab keys and the `?tab=` URL contract (shared by the page and the client tabs). */
export const SETTINGS_TABS = ["taxes", "categories", "general", "data"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** `?tab=` value → a known tab (default "taxes"). Links: `/settings?tab=categories`, `/settings#esv`. */
export function parseSettingsTab(value: string | string[] | undefined): SettingsTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (SETTINGS_TABS as readonly string[]).includes(v ?? "") ? (v as SettingsTab) : "taxes";
}
