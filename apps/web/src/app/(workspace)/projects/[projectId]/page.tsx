import { can, propertyTypeLabel } from '@property/domain';
import { loadProject } from '@/server/page-project';
import { EditProjectForm } from '@/components/forms';
import { ProjectHeading } from '@/components/project-heading';
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const project = await loadProject((await params).projectId);
  return <><ProjectHeading project={project} active="details" /><div className="split-layout"><section className="form-panel"><h2 className="panel-title">Project details</h2><p className="intro small">The starting point for everything you plan here.</p>{can(project.role, 'project:edit') ? <EditProjectForm key={project.revision} project={project} /> : <dl className="definition-list"><div><dt>Project name</dt><dd>{project.name}</dd></div><div><dt>Property type</dt><dd>{propertyTypeLabel(project.propertyType)}</dd></div><div><dt>Access</dt><dd>You can view this project’s summary.</dd></div></dl>}</section>
    <aside className="side-note"><p className="eyebrow">A CONTINUOUS RECORD</p><h2>Version {project.revision.toString().padStart(2, '0')}</h2><dl className="definition-list"><div><dt>Created</dt><dd>{new Date(project.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}</dd></div><div><dt>Last updated</dt><dd>{new Date(project.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}</dd></div><div><dt>Project ID</dt><dd><code>{project.id}</code></dd></div></dl><p className="help">This identity stays with the project, even when its details change.</p></aside></div></>;
}
