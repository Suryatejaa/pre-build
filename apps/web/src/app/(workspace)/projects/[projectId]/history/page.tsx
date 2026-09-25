import Link from 'next/link';
import { SiteReview } from '@/components/site-preview';
import { notFound } from 'next/navigation';
import { can, paginationSchema, propertyTypeLabel } from '@property/domain';
import { loadProject } from '@/server/page-project';
import { getContainer } from '@/server/container';
import { requireUser } from '@/server/session';
import { ProjectHeading } from '@/components/project-heading';
export default async function HistoryPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ page?: string }> }) {
  const project = await loadProject((await params).projectId);
  if (!can(project.role, 'versions:read')) notFound();
  const user = await requireUser();
  const parsed = paginationSchema.safeParse(await searchParams);
  if (!parsed.success) notFound();
  const history = await getContainer().projects.versions({ userId: user.id }, project.id, parsed.data);
  return <><ProjectHeading project={project} active="history" /><section className="history-panel"><h2>Every change has a place.</h2><p className="intro small">Previous versions are preserved. Open a record to see the details at that time.</p>
    {history.items.length ? <ol className="history-list">{history.items.map(version => <li key={version.id}><span className="version-number">{String(version.revision).padStart(2, '0')}</span><div><div className="history-title"><h3>{version.changeReason}</h3>{version.revision === project.revision && <span className="status">Current</span>}</div><p className="help">{new Date(version.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {version.source === 'HUMAN' ? 'Saved by a person' : version.source}</p><details><summary>View saved details</summary><dl className="definition-list"><div><dt>Project name</dt><dd>{version.snapshot.name}</dd></div><div><dt>Property type</dt><dd>{propertyTypeLabel(version.snapshot.propertyType)}</dd></div><div><dt>Status</dt><dd>{version.snapshot.status === 'ACTIVE' ? 'Active' : 'Archived'}</dd></div><div><dt>Changed by (account ID)</dt><dd><code>{version.createdBy}</code></dd></div><div><dt>Version ID</dt><dd><code>{version.id}</code></dd></div></dl>{version.snapshot.site ? <SiteReview site={version.snapshot.site} /> : <p className="help">{version.redactedFields ? "Private site details and change notes are visible only to the owner." : "No land/site information in this version."}</p>}</details></div></li>)}</ol> : <section className="empty-state compact-empty"><p className="eyebrow">A QUIET RECORD</p><h2>No saved versions yet.</h2><p>This project’s first saved change will appear here.</p></section>}
    <nav className="pagination" aria-label="History pages">{parsed.data.page > 1 && <Link href={`?page=${parsed.data.page - 1}`}>← Newer versions</Link>}{history.nextPage && <Link href={`?page=${history.nextPage}`}>Older versions →</Link>}</nav>
    </section></>;
}
