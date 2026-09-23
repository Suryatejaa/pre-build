import { notFound } from 'next/navigation';
import { can } from '@property/domain';
import { loadProject } from '@/server/page-project';
import { getContainer } from '@/server/container';
import { requireUser } from '@/server/session';
import { ProjectHeading } from '@/components/project-heading';
import { AccessForm } from '@/components/forms';
export default async function AccessPage({ params }: { params: Promise<{ projectId: string }> }) {
  const project = await loadProject((await params).projectId);
  if (!can(project.role, 'members:manage')) notFound();
  const user = await requireUser();
  const members = await getContainer().projects.members({ userId: user.id }, project.id);
  return <><ProjectHeading project={project} active="access" /><div className="split-layout"><section className="form-panel"><h2>People with access</h2><p className="intro small">Choose who can see this project.</p><AccessForm projectId={project.id} members={members} /></section><aside className="side-note"><p className="eyebrow">YOU ARE IN CONTROL</p><h2>Clear roles.<br />Considered access.</h2><p>Access belongs to this project alone. Adding someone here never gives them access to your other projects.</p><div className="note-rule" /><p className="help">Ownership cannot be reassigned through access settings. Every access change is recorded.</p></aside></div></>;
}
