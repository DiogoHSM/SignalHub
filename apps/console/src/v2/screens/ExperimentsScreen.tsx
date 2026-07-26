import { useState } from "react";
import { EmptyHint, PageHead, Segmented } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { AbTestsTab } from "./experiments/AbTestsTab";
import { FeatureFlagsTab } from "./experiments/FeatureFlagsTab";
import { SurveysTab } from "./experiments/SurveysTab";
import { CampaignsTab } from "./experiments/CampaignsTab";
import { BetaProgramsTab } from "./experiments/BetaProgramsTab";
import { useFeatureFlags } from "./experiments/useFeatureFlags";

const TABS = ["A/B", "Flags", "Surveys", "Campaigns", "Beta"] as const;
export type ExperimentsTab = (typeof TABS)[number];

export function ExperimentsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [tab, setTab] = useState<ExperimentsTab>("A/B");

  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  // Feature flags are the one cross-tab dependency (beta programs link to a flag):
  // fetch once here — enabled while either the Flags or Beta tab is active — and
  // pass the list down instead of refetching per tab.
  const flagsEnabled = tab === "Flags" || tab === "Beta";
  const featureFlags = useFeatureFlags({ client: ctx.client, projectId, environmentId, enabled: flagsEnabled });

  if (!ctx.project || !ctx.environment) {
    return (
      <>
        <PageHead title="Experiments" />
        <EmptyHint
          icon="flag"
          title="No project selected"
          sub="Select a project and environment to view experiments."
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Experiments"
        sub="A/B tests, feature flags, surveys, message campaigns, and beta programs."
        actions={<Segmented options={[...TABS]} value={tab} onChange={(v) => setTab(v as ExperimentsTab)} />}
      />
      {tab === "A/B" ? <AbTestsTab ctx={ctx} enabled={tab === "A/B"} /> : null}
      {tab === "Flags" ? <FeatureFlagsTab ctx={ctx} flags={featureFlags} /> : null}
      {tab === "Surveys" ? <SurveysTab ctx={ctx} enabled={tab === "Surveys"} /> : null}
      {tab === "Campaigns" ? <CampaignsTab ctx={ctx} enabled={tab === "Campaigns"} /> : null}
      {tab === "Beta" ? <BetaProgramsTab ctx={ctx} flags={featureFlags} enabled={tab === "Beta"} /> : null}
    </>
  );
}
