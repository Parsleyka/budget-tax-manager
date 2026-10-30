import type { Metadata } from "next";
import { CategoriesSection } from "@/components/settings/categories-section";
import { DataSection } from "@/components/settings/data-section";
import { Disclosure } from "@/components/settings/disclosure";
import { EsvExplainer } from "@/components/settings/esv-explainer";
import { GeneralSection } from "@/components/settings/general-section";
import { RulesTables } from "@/components/settings/rules-tables";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { parseSettingsTab } from "@/components/settings/tabs";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";
import { PageHeader } from "@/components/shared/page-header";
import { getSettingsPageData } from "@/server/queries";

export const metadata: Metadata = { title: "Settings" };

/**
 * /settings — tabs: Taxes (ФОП settings; the read-only rule tables collapsed under "Rules reference"),
 * Categories, General (main account), Data (folder, export, import). `?tab=categories|general|data`
 * opens a tab; `#esv` jumps to the ЄСВ section of the Taxes tab.
 */
export default async function SettingsPage(props: PageProps<"/settings">) {
  const [data, searchParams] = await Promise.all([getSettingsPageData(), props.searchParams]);
  const { settings, today } = data;

  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs
        initialTab={parseSettingsTab(searchParams.tab)}
        panels={{
          taxes: (
            <>
              {/* Remount when the saved tax settings change (after a save or an import) so the draft resets. */}
              <TaxSettingsForm key={JSON.stringify(settings.tax)} tax={settings.tax} today={today} />
              <Disclosure title="Rules reference">
                <RulesTables rules={data.rules} today={today} tax={settings.tax} />
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">How ЄСВ works when you are also employed</h3>
                  <EsvExplainer today={today} />
                </section>
              </Disclosure>
            </>
          ),
          categories: <CategoriesSection categories={data.categories} />,
          general: <GeneralSection accounts={data.accounts} defaultActiveAccountId={settings.defaultActiveAccountId} />,
          data: <DataSection dataDir={data.dataDir} files={data.files} />,
        }}
      />
    </>
  );
}
