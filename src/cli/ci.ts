import * as process from "process";
import { createHash } from "crypto";

// A map from CI providers to environment variables that uniquely identify a project.
// If present, these variables are hashed to produce a unique userId for quicktype in CI.
function getProviders(env: any = process.env): [string, Array<string | undefined>][] {
    return [
        ["Travis", [env.TRAVIS_REPO_SLUG]],
        ["Jenkins", [env.JENKINS_URL]],
        ["TeamCity", [env.TEAMCITY_PROJECT_NAME]],
        ["CircleCI", [env.CIRCLE_PROJECT_USERNAME, env.CIRCLE_PROJECT_REPONAME]],
        ["Codeship", [env.CI_REPO_NAME]],
        ["GitLab", [env.GITLAB_CI, env.CI_REPOSITORY_URL, env.CI_PROJECT_ID]],
        ["VSTS", [env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI, env.BUILD_REPOSITORY_NAME]],
        ["App Center", [env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI, env.BUILD_REPOSITORY_NAME]],
        // We intentionally collapse users with env.CI to prevent over-counting for unidentified CI
        ["Other", [env.CI]]
    ];
}

export function tryHash(envs: Array<string | undefined>): string | undefined {
    if (envs.some(s => s === undefined)) {
        return undefined;
    }
    const hash = createHash("sha256");
    envs.forEach(s => hash.update(s as string));
    return hash.digest("base64");
}

export function getProvider(environment?: any): { provider: string; userId: string } | undefined {
    for (const [provider, vars] of getProviders(environment)) {
        const hash = tryHash(vars);
        if (hash !== undefined) {
            return { provider, userId: hash };
        }
    }
    return undefined;
}
