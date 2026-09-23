import type { ProjectService } from '@property/services';
import type { AuthenticationProvider } from '@property/domain';
import { authenticated, json, readJson } from './http';

export function createProjectApi(projects: ProjectService, auth: AuthenticationProvider, origin: string) {
  return {
    collection(request: Request) {
      return authenticated(request, auth, origin, async actor => {
        if (request.method === 'GET') return json(await projects.list(actor, { page: new URL(request.url).searchParams.get('page') ?? 1 }));
        return json(await projects.create(actor, await readJson(request)), 201);
      });
    },
    project(request: Request, projectId: string) {
      return authenticated(request, auth, origin, async actor => request.method === 'GET'
        ? json(await projects.get(actor, projectId))
        : json(await projects.update(actor, projectId, await readJson(request))));
    },
    site(request: Request, projectId: string) {
      return authenticated(request, auth, origin, async actor => request.method === 'GET'
        ? json(await projects.site(actor, projectId))
        : json(await projects.saveSite(actor, projectId, await readJson(request))));
    },
    versions(request: Request, projectId: string) {
      return authenticated(request, auth, origin, async actor => json(await projects.versions(actor, projectId, { page: new URL(request.url).searchParams.get('page') ?? 1 })));
    },
    version(request: Request, projectId: string, versionId: string) {
      return authenticated(request, auth, origin, async actor => json(await projects.version(actor, projectId, versionId)));
    },
    members(request: Request, projectId: string) {
      return authenticated(request, auth, origin, async actor => {
        if (request.method === 'GET') return json(await projects.members(actor, projectId));
        await projects.assignMember(actor, projectId, await readJson(request));
        return new Response(null, { status: 204 });
      });
    },
    member(request: Request, projectId: string, userId: string) {
      return authenticated(request, auth, origin, async actor => {
        await projects.removeMember(actor, projectId, userId);
        return new Response(null, { status: 204 });
      });
    },
  };
}
