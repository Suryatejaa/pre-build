import { notFound } from 'next/navigation';
import { can } from '@property/domain';
import { loadProject } from '@/server/page-project';
import { getContainer } from '@/server/container';
import { requireUser } from '@/server/session';
import { ProjectHeading } from '@/components/project-heading';
import { RequirementsWorkspace } from '@/components/requirements-workspace';

export default async function RequirementsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const project = await loadProject((await params).projectId);
  if (!can(project.role, 'project:edit')) notFound();
  const user = await requireUser();
  const initial = await getContainer().requirements.get({ userId: user.id }, project.id);
  return <><ProjectHeading project={project} active="requirements" /><div className="page-heading requirements-heading"><div><p className="eyebrow">PHASE 3 · OWNER REQUIREMENTS</p><h1>What do you want to build?</h1><p className="intro">Describe your needs naturally, review the structured Project Brief, and approve it when it is complete.</p></div></div><RequirementsWorkspace key={`${project.id}-${initial.interview?.id ?? 'new'}`} projectId={project.id} initial={initial} /></>;
}
