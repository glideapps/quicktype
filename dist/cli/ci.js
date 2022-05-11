"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const process = require("process");
const crypto_1 = require("crypto");
// A map from CI providers to environment variables that uniquely identify a project.
// If present, these variables are hashed to produce a unique userId for quicktype in CI.
function getProviders(env = process.env) {
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
function tryHash(envs) {
    if (envs.some(s => s === undefined)) {
        return undefined;
    }
    const hash = crypto_1.createHash("sha256");
    envs.forEach(s => hash.update(s));
    return hash.digest("base64");
}
exports.tryHash = tryHash;
function getProvider(environment) {
    for (const [provider, vars] of getProviders(environment)) {
        const hash = tryHash(vars);
        if (hash !== undefined) {
            return { provider, userId: hash };
        }
    }
    return undefined;
}
exports.getProvider = getProvider;
