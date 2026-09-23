import 'server-only';
import { getContainer } from './container';
import { createProjectApi } from './project-api';
export function projectApi() {
  const { projects, auth, config } = getContainer();
  return createProjectApi(projects, auth.provider, config.APP_URL);
}
