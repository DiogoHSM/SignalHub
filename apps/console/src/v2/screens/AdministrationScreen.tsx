import { PageHead } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSystemUsers } from "./useSystem";
import { ConsoleAccessSection } from "./settings/ConsoleAccessSection";
import { ManagementSection } from "./settings/ManagementSections";

export function AdministrationScreen({ ctx }: { ctx: ScreenCtx }) {
  const users = useSystemUsers({ client: ctx.client, enabled: ctx.user?.isAdmin === true });
  return <>
    <PageHead title="Administration" sub="Projects and console access across this Sigmon instance." />
    <ManagementSection ctx={ctx} kind="projects" />
    {ctx.user?.isAdmin && <ConsoleAccessSection currentUser={ctx.user} users={users} pushToast={ctx.pushToast} />}
  </>;
}
