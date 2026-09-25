import type { Pool, PoolClient } from 'pg';
import {
  DomainError, PAGE_SIZE, interviewCandidateSchema, interviewMessageSchema, projectSnapshotSchema, roleSchema,
  type AiRequestRecord, type ChangeSource, type InterviewMessage, type MemberRole, type Page, type Principal, type ProjectMember,
  type ProjectVersion, type PropertyProject, type RequirementsInterview,
} from '@property/domain';
import type { AuditEntry, AuthorizedProject, ProjectRepository, ProjectUnitOfWork, RequirementsRepository, RequirementsUnitOfWork } from '@property/services';

type Connection = Pick<Pool, 'query'>;
interface VersionRow {
  id: string; project_id: string; revision: number; snapshot: unknown; created_by: string;
  created_at: Date; source: ChangeSource; change_reason: string;
}
interface ProjectRow {
  id: string; owner_user_id: string; current_revision: number; created_at: Date; updated_at: Date;
  version: Omit<VersionRow, 'created_at'> & { created_at: string }; role: string;
}
const projection = `p.*, row_to_json(v) AS version,
  CASE WHEN p.owner_user_id = $1 THEN 'OWNER' ELSE m.role END AS role`;
const from = `FROM property_projects p
  JOIN project_versions v ON v.project_id = p.id AND v.revision = p.current_revision
  LEFT JOIN project_memberships m ON m.project_id = p.id AND m.user_id = $1`;
function mapVersion(row: VersionRow): ProjectVersion {
  return { id: row.id, projectId: row.project_id, revision: row.revision,
    snapshot: projectSnapshotSchema.parse(row.snapshot), createdBy: row.created_by,
    createdAt: row.created_at.toISOString(), source: row.source, changeReason: row.change_reason };
}
function mapProject(row: ProjectRow): AuthorizedProject {
  return { role: roleSchema.parse(row.role), project: {
    id: row.id, ownerUserId: row.owner_user_id, currentRevision: row.current_revision,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    currentVersion: mapVersion({ ...row.version, created_at: new Date(row.version.created_at) }),
  } };
}
function pageResult<T>(items: T[], page: number): Page<T> {
  return { items: items.slice(0, PAGE_SIZE), nextPage: items.length > PAGE_SIZE ? page + 1 : null };
}

class PgProjectRepository implements ProjectRepository {
  constructor(private readonly db: Connection) {}
  async list(actor: Principal, page: number) {
    const result = await this.db.query<ProjectRow>(`SELECT ${projection} ${from}
      WHERE p.owner_user_id = $1 OR m.user_id IS NOT NULL
      ORDER BY p.created_at DESC, p.id LIMIT $2 OFFSET $3`, [actor.userId, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
    return pageResult(result.rows.map(mapProject), page);
  }
  async find(actor: Principal, projectId: string, lock = false) {
    if (lock) {
      // Lock the identity first, then read the current snapshot in a fresh READ COMMITTED statement.
      // Joining the snapshot in the locking statement can retain an old join during a concurrent edit.
      const locked = await this.db.query(`SELECT p.id FROM property_projects p WHERE p.id=$2
        AND (p.owner_user_id=$1 OR EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id=p.id AND m.user_id=$1))
        FOR UPDATE`, [actor.userId, projectId]);
      if (!locked.rowCount) return null;
    }
    const result = await this.db.query<ProjectRow>(`SELECT ${projection} ${from}
      WHERE p.id = $2 AND (p.owner_user_id = $1 OR m.user_id IS NOT NULL)`, [actor.userId, projectId]);
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }
  private async insertVersion(version: ProjectVersion) {
    await this.db.query(`INSERT INTO project_versions(id, project_id, revision, schema_version, snapshot, created_by, created_at, source, change_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [version.id, version.projectId, version.revision, version.snapshot.schemaVersion,
      JSON.stringify(version.snapshot), version.createdBy, version.createdAt, version.source, version.changeReason]);
  }
  async create(project: PropertyProject) {
    await this.db.query(`INSERT INTO property_projects(id, owner_user_id, current_revision, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5)`, [project.id, project.ownerUserId, project.currentRevision, project.createdAt, project.updatedAt]);
    await this.insertVersion(project.currentVersion);
  }
  async appendVersion(project: PropertyProject, expectedRevision: number) {
    const result = await this.db.query(`UPDATE property_projects SET current_revision=$1, updated_at=$2
      WHERE id=$3 AND current_revision=$4`, [project.currentRevision, project.updatedAt, project.id, expectedRevision]);
    if (result.rowCount !== 1) throw new DomainError('CONFLICT', 'Project changed. Reload before saving.');
    await this.insertVersion(project.currentVersion);
  }
  async versions(projectId: string, page: number) {
    const result = await this.db.query<VersionRow>(`SELECT * FROM project_versions WHERE project_id=$1
      ORDER BY revision DESC LIMIT $2 OFFSET $3`, [projectId, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
    return pageResult(result.rows.map(mapVersion), page);
  }
  async version(projectId: string, versionId: string) {
    const result = await this.db.query<VersionRow>('SELECT * FROM project_versions WHERE project_id=$1 AND id=$2', [projectId, versionId]);
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }
  async members(project: PropertyProject): Promise<ProjectMember[]> {
    const result = await this.db.query<{ user_id: string; name: string; role: string; joined_at: Date }>(`
      SELECT u.id AS user_id, u.name, 'OWNER' AS role, p.created_at AS joined_at
      FROM property_projects p JOIN "user" u ON u.id=p.owner_user_id WHERE p.id=$1
      UNION ALL
      SELECT u.id AS user_id, u.name, m.role, m.created_at AS joined_at
      FROM project_memberships m JOIN "user" u ON u.id=m.user_id WHERE m.project_id=$1
      ORDER BY joined_at, user_id`, [project.id]);
    return result.rows.map(row => ({ userId: row.user_id, name: row.name, role: roleSchema.parse(row.role), joinedAt: row.joined_at.toISOString() }));
  }
  async userExists(userId: string) {
    return (await this.db.query('SELECT 1 FROM "user" WHERE id=$1', [userId])).rowCount === 1;
  }
  async member(projectId: string, userId: string) {
    const result = await this.db.query<{ role: MemberRole }>('SELECT role FROM project_memberships WHERE project_id=$1 AND user_id=$2', [projectId, userId]);
    return result.rows[0] ?? null;
  }
  async assignMember(projectId: string, userId: string, role: MemberRole, actorId: string) {
    await this.db.query(`INSERT INTO project_memberships(project_id,user_id,role,granted_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role, granted_by=excluded.granted_by, updated_at=now()`, [projectId, userId, role, actorId]);
  }
  async removeMember(projectId: string, userId: string) {
    await this.db.query('DELETE FROM project_memberships WHERE project_id=$1 AND user_id=$2', [projectId, userId]);
  }
  async audit(entry: AuditEntry) {
    await this.db.query(`INSERT INTO audit_events(id,project_id,project_version_id,actor_id,action,source,before_data,after_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [entry.id, entry.projectId, entry.projectVersionId, entry.actorId, entry.action,
      entry.source, entry.before === null ? null : JSON.stringify(entry.before), entry.after === null ? null : JSON.stringify(entry.after)]);
  }
}
interface InterviewRow {
  id: string; project_id: string; owner_id: string; status: RequirementsInterview['status']; candidate: unknown;
  expected_project_revision: number; approved_project_version_id: string | null; created_at: Date; updated_at: Date;
}
interface InterviewMessageRow {
  id: string; interview_id: string; role: InterviewMessage['role']; content: string; created_at: Date; provider: string | null; model: string | null;
}
class PgRequirementsRepository extends PgProjectRepository implements RequirementsRepository {
  constructor(private readonly connection: Connection) { super(connection); }
  async interview(projectId: string): Promise<RequirementsInterview | null> {
    const result = await this.connection.query<InterviewRow>(`SELECT * FROM requirements_interviews WHERE project_id=$1
      ORDER BY created_at DESC, id DESC LIMIT 1`, [projectId]);
    const row = result.rows[0];
    if (!row) return null;
    const messages = await this.connection.query<InterviewMessageRow>(`SELECT * FROM requirements_interview_messages WHERE interview_id=$1 ORDER BY sequence_no`, [row.id]);
    return { id: row.id, projectId: row.project_id, ownerId: row.owner_id, status: row.status,
      candidate: interviewCandidateSchema.parse(row.candidate), expectedProjectRevision: row.expected_project_revision,
      approvedProjectVersionId: row.approved_project_version_id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      messages: messages.rows.map(message => interviewMessageSchema.parse({ id: message.id, interviewId: message.interview_id, role: message.role,
        content: message.content, createdAt: message.created_at.toISOString(), provider: message.provider, model: message.model })) };
  }
  async createInterview(interview: Omit<RequirementsInterview, 'messages'>) {
    await this.connection.query(`INSERT INTO requirements_interviews(id,project_id,owner_id,status,candidate,expected_project_revision,approved_project_version_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [interview.id, interview.projectId, interview.ownerId, interview.status,
      JSON.stringify(interview.candidate), interview.expectedProjectRevision, interview.approvedProjectVersionId, interview.createdAt, interview.updatedAt]);
  }
  async saveInterview(interview: Omit<RequirementsInterview, 'messages'>) {
    const result = await this.connection.query(`UPDATE requirements_interviews SET status=$1,candidate=$2,expected_project_revision=$3,
      approved_project_version_id=$4,updated_at=$5 WHERE id=$6 AND project_id=$7`, [interview.status, JSON.stringify(interview.candidate),
      interview.expectedProjectRevision, interview.approvedProjectVersionId, interview.updatedAt, interview.id, interview.projectId]);
    if (result.rowCount !== 1) throw new DomainError('CONFLICT', 'The requirements interview changed. Reload before continuing.');
  }
  async appendInterviewMessage(message: InterviewMessage) {
    const result = await this.connection.query<{ next_sequence: number }>(`SELECT COALESCE(MAX(sequence_no),0)+1 AS next_sequence FROM requirements_interview_messages WHERE interview_id=$1`, [message.interviewId]);
    await this.connection.query(`INSERT INTO requirements_interview_messages(id,interview_id,sequence_no,role,content,provider,model,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [message.id, message.interviewId, result.rows[0]!.next_sequence,
      message.role, message.content, message.provider, message.model, message.createdAt]);
  }
  async recordAiRequest(request: AiRequestRecord) {
    await this.connection.query(`INSERT INTO requirements_ai_requests(id,interview_id,provider,model,request_type,occurred_at,succeeded,latency_ms,input_tokens,output_tokens,retry_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [request.id, request.interviewId, request.provider, request.model, request.requestType,
      request.occurredAt, request.succeeded, request.latencyMs, request.inputTokens, request.outputTokens, request.retryCount]);
  }
}
export function createProjectUnitOfWork(pool: Pool): ProjectUnitOfWork {
  return {
    read: new PgProjectRepository(pool),
    async transaction<T>(work: (repo: ProjectRepository) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(new PgProjectRepository(client));
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
export function createRequirementsUnitOfWork(pool: Pool): RequirementsUnitOfWork {
  return {
    read: new PgRequirementsRepository(pool),
    async transaction<T>(work: (repo: RequirementsRepository) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(new PgRequirementsRepository(client));
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
