import { propertyTypeLabel } from '@property/domain';
import Link from 'next/link';
import { getContainer } from '@/server/container';
import { requireUser } from '@/server/session';
import { paginationSchema } from '@property/domain';
import { notFound } from 'next/navigation';

export default async function Projects({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const parsed = paginationSchema.safeParse(await searchParams);
  if (!parsed.success) notFound();
  const { items, nextPage } = await getContainer().projects.list({ userId: user.id }, parsed.data);
  return <><div className="page-heading"><div><p className="eyebrow">YOUR PROPERTY WORKSPACE</p><h1>Your projects.</h1><p className="intro">Every home starts with a place to bring it together.</p></div><Link className="button primary" href="/projects/new"><span aria-hidden="true">＋</span> New project</Link></div>
    <div className="section-heading"><h2>Property projects</h2><span className="quiet-label">Private to you and people you add</span></div>
    {items.length ? <div className="project-list">{items.map(project => <Link key={project.id} href={`/projects/${project.id}`} className="project-row"><span className="project-symbol" aria-hidden="true">⌂</span><div className="project-title"><h3>{project.name}</h3><p>{propertyTypeLabel(project.propertyType)} <span aria-hidden="true">·</span> {project.role === 'OWNER' ? 'Your project' : 'Shared with you'}</p></div><span className={`status ${project.status === 'ARCHIVED' ? 'muted' : ''}`}>{project.status === 'ACTIVE' ? 'Active' : 'Archived'}</span><span className="project-revision">Version {project.revision}</span><span className="row-arrow" aria-hidden="true">↗</span></Link>)}</div>
      : <section className="empty-state"><div className="empty-line" aria-hidden="true">⌂</div><p className="eyebrow">A NEW BEGINNING</p><h2>{parsed.data.page > 1 ? 'No more projects here.' : 'Make room for your home.'}</h2><p>Create a project to establish its record.<br />Your details, access, and version history will live here.</p><Link className="button primary" href="/projects/new">Create your first project <span aria-hidden="true">↗</span></Link></section>}
    <nav className="pagination" aria-label="Project pages">{parsed.data.page > 1 && <Link href={`/projects?page=${parsed.data.page - 1}`}>← Previous</Link>}{nextPage && <Link href={`/projects?page=${nextPage}`}>More projects →</Link>}</nav>
    <aside className="workspace-note"><span className="note-number">01</span><div><strong>A reliable beginning</strong><p>A unique project record, clear ownership, and a history that stays with your property.</p></div></aside>
  </>;
}
