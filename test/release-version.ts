import { strict as assert } from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    npmDistTag,
    parseReleaseTag,
    publishAction,
    stampManifests,
    validateAgainstPreviousReleases,
} from "../script/release-version";

assert.equal(parseReleaseTag("v24.1.2"), "24.1.2");
assert.equal(parseReleaseTag("v25.0.0-pre1"), "25.0.0-pre1");
assert.equal(parseReleaseTag("v25.0.0-pre10"), "25.0.0-pre10");
for (const tag of [
    "24.1.2",
    "v24.1",
    "v24.1.2-beta.1",
    "v25.0.0-pre0",
    "v25.0.0-pre01",
    "v024.1.2",
    "release-v24.1.2",
]) {
    assert.throws(() => parseReleaseTag(tag));
}

assert.equal(npmDistTag("24.1.2"), "latest");
assert.equal(npmDistTag("25.0.0-pre1"), "pre");

assert.equal(
    publishAction("24.0.0", ["23.3.2", "24.0.0-beta.1"], "test"),
    "publish",
);
assert.equal(publishAction("24.0.0", ["23.3.2", "24.0.0"], "test"), "skip");
assert.equal(
    publishAction("25.0.0-pre2", ["24.0.0", "25.0.0-pre1"], "test"),
    "publish",
);
assert.equal(publishAction("25.0.0-pre10", ["25.0.0-pre9"], "test"), "publish");
assert.equal(publishAction("25.0.0", ["25.0.0-pre2"], "test"), "publish");
assert.throws(
    () => publishAction("25.0.0-pre2", ["25.0.0"], "test"),
    /newer version/,
);
assert.throws(
    () => publishAction("24.0.0", ["24.0.1"], "test"),
    /newer version/,
);

const releases = [
    { id: 1, tag_name: "v23.3.0", draft: false, prerelease: false },
    { id: 2, tag_name: "v24.0.0", draft: false, prerelease: false },
    { id: 3, tag_name: "v99.0.0", draft: true, prerelease: false },
    { id: 4, tag_name: "v25.0.0-beta.1", draft: false, prerelease: true },
];
assert.equal(validateAgainstPreviousReleases("24.0.0", 2, releases), "23.3.0");
assert.equal(
    validateAgainstPreviousReleases("24.1.0-pre2", 6, [
        ...releases,
        {
            id: 5,
            tag_name: "v24.1.0-pre1",
            draft: false,
            prerelease: true,
        },
    ]),
    "24.1.0-pre1",
);
assert.throws(
    () => validateAgainstPreviousReleases("23.2.0", 2, releases),
    /must be greater/,
);

const root = mkdtempSync(join(tmpdir(), "quicktype-release-version-"));
try {
    const packageFiles: Record<string, object> = {
        "package.json": {
            version: "1.0.0",
            dependencies: {
                "quicktype-core": "1.0.0",
                "quicktype-graphql-input": "1.0.0",
                "quicktype-typescript-input": "1.0.0",
            },
        },
        "packages/quicktype-core/package.json": { version: "2.0.0" },
        "packages/quicktype-graphql-input/package.json": {
            version: "2.0.0",
            dependencies: { "quicktype-core": "file:../quicktype-core" },
        },
        "packages/quicktype-typescript-input/package.json": {
            version: "2.0.0",
            dependencies: { "quicktype-core": "file:../quicktype-core" },
        },
        "packages/quicktype-vscode/package.json": {
            version: "3.0.0",
            dependencies: { unrelated: "1.0.0" },
        },
    };
    for (const [relativePath, contents] of Object.entries(packageFiles)) {
        const path = join(root, relativePath);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, JSON.stringify(contents));
    }

    stampManifests(root, "24.0.0");
    for (const relativePath of Object.keys(packageFiles)) {
        const manifest = JSON.parse(
            readFileSync(join(root, relativePath), "utf8"),
        ) as {
            version: string;
            dependencies?: Record<string, string>;
        };
        assert.equal(manifest.version, "24.0.0");
        for (const [name, version] of Object.entries(
            manifest.dependencies ?? {},
        )) {
            assert.equal(
                version,
                name.startsWith("quicktype-") ? "24.0.0" : "1.0.0",
            );
        }
    }

    stampManifests(root, "25.0.0-pre1");
    for (const relativePath of Object.keys(packageFiles)) {
        const manifest = JSON.parse(
            readFileSync(join(root, relativePath), "utf8"),
        ) as {
            version: string;
            dependencies?: Record<string, string>;
        };
        assert.equal(manifest.version, "25.0.0-pre1");
        for (const [name, version] of Object.entries(
            manifest.dependencies ?? {},
        )) {
            assert.equal(
                version,
                name.startsWith("quicktype-") ? "25.0.0-pre1" : "1.0.0",
            );
        }
    }
} finally {
    rmSync(root, { recursive: true, force: true });
}

console.log("release version tests passed");
