import { notFound } from 'next/navigation';
import { can } from '@property/domain';
import { loadProject } from '@/server/page-project';
import { getContainer } from '@/server/container';
import { requireUser } from '@/server/session';
import { ProjectHeading } from '@/components/project-heading';
import { SiteForm } from '@/components/site-form';
export default async function SitePage({ params }: { params: Promise<{ projectId: string }> }) {
  const project = await loadProject((await params).projectId);
  if (!can(project.role, 'site:read')) notFound();
  const user = await requireUser();
  const state = await getContainer().projects.site({ userId: user.id }, project.id);
  return <><ProjectHeading project={project} active="site" /><h2>Land &amp; site</h2><SiteForm key={project.id} projectId={project.id} revision={state.revision} site={state.site} /></>;
}
