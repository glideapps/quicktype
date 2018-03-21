import * as ga from "universal-analytics";
import * as storage from "./storage";

import { env } from "process";
import { createHash } from "crypto";

const uuid = require("uuid/v4");

const GoogleAnalyticsID = "UA-102732788-5";

// A map from CI providers to environment variables that uniquely identify a project.
// If present, these variables are hashed to produce a unique userId for quicktype in CI.
const CIProviders: [string, Array<string | undefined>][] = [
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

function getCIProvider(): { provider: string; userId: string } | undefined {
    function tryHash(envs: Array<string | undefined>): string | undefined {
        if (envs.some(s => s === undefined)) {
            return undefined;
        }
        const hash = createHash("sha256");
        envs.forEach(s => hash.update(s as string));
        return hash.digest("base64");
    }

    for (const [provider, vars] of CIProviders) {
        const hash = tryHash(vars);
        if (hash !== undefined) {
            return { provider, userId: hash };
        }
    }
    return undefined;
}

export interface Analytics {
    pageview(page: string): void;
    timing(category: string, variable: string, time: number): void;
    event(category: string, action: string, label?: string, value?: string | number): void;
}

export class NoAnalytics implements Analytics {
    pageview(_page: string): void {
        // Pass
    }

    timing(_category: string, _variable: string, _time: number): void {
        // Pass
    }

    event(_category: string, _action: string, _label?: string, _value?: string | number): void {
        // Pass
    }
}

export class GoogleAnalytics implements Analytics {
    private readonly visitor: ga.Visitor;

    constructor() {
        const ci = getCIProvider();
        const userId = ci !== undefined ? ci.userId : storage.get("userId", uuid());

        this.visitor = ga(GoogleAnalyticsID, userId);

        if (ci !== undefined) {
            this.ciProvider = ci.provider;
        }
    }

    set ciProvider(provider: string) {
        this.visitor.set("dimension1", provider);
    }

    pageview(page: string): void {
        this.visitor.pageview(page).send();
    }

    timing(category: string, variable: string, time: number): void {
        this.visitor.timing(category, variable, time).send();
    }

    event(category: string, action: string, label?: string, value?: string | number): void {
        if (label !== undefined) {
            if (value !== undefined) {
                this.visitor.event(category, action, label, value).send();
            } else {
                this.visitor.event(category, action, label).send();
            }
        } else {
            this.visitor.event(category, action).send();
        }
    }
}
