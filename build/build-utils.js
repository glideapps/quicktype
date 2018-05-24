"use strict";

const fs = require("fs");
const path = require("path");
const spawnSync = require("child_process").spawnSync;

function mapFile(source, destination, transform) {
    const content = fs.readFileSync(source, "utf8");
    fs.writeFileSync(destination, transform(content));
}

function run(cmd, args, returnOutput = false, returnStatus = false) {
    // console.log(`running ${cmd} ${args.join(" ")}`);
    const result = spawnSync(cmd, args, { stdio: returnOutput ? "pipe" : "inherit" });
    // console.log(`result ${JSON.stringify(result)}`);
    if (result.error) {
        console.log(result.error);
        process.exit(1);
    }
    if (returnStatus) {
        return result.status;
    }
    if (result.status !== 0) {
        console.log(`Command ${cmd} ${args.join(" ")} failed`);
        process.exit(1);
    }
    if (returnOutput) {
        const output = result.output[1].toString();
        // console.log(`output ${output}`);
        return output;
    }
}

function gitRevParse(rev) {
    return run("git", ["rev-parse", rev], true).trim();
}

function gitHasDiff(oldRev, inDir) {
    return run("git", ["diff", "--quiet", oldRev, inDir], false, true) !== 0;
}

function latestPackageVersion(packageName) {
    const versions = JSON.parse(run("npm", ["show", "--json", packageName, "versions"], true));
    return versions[versions.length - 1];
}

function packageCommit(packageName, version) {
    const commit = run("npm", ["show", `${packageName}@${version}`, "config.commit"], true).trim();
    if (commit === "") {
        console.error("Error: No commit for latest package version");
        process.exit(1);
    }
    return commit;
}

function copyFile(src, dst) {
    run("cp", [src, dst]);
}

function endsWith(str, suffix) {
    if (str.length < suffix.length) return false;
    return str.substr(str.length - suffix.length) === suffix;
}

function replaceAll(content, from, to) {
    for (;;) {
        const newContent = content.replace(from, to);
        if (content === newContent) return content;
        content = newContent;
    }
}

function ignoreExceptions(f) {
    try {
        f();
    } catch (e) {}
}

function inDir(dir, f) {
    const originalDir = process.cwd();
    process.chdir(dir);
    try {
        f(path.basename(dir));
    } finally {
        process.chdir(originalDir);
    }
}

function withPackage(update, f) {
    const pkg = JSON.parse(fs.readFileSync("package.in.json", "utf8"));
    update(pkg);
    fs.writeFileSync("package.json", JSON.stringify(pkg, undefined, 4));
    try {
        f();
    } finally {
        ignoreExceptions(() => fs.unlinkSync("package.json"));
    }
}

function setQuicktypeCore(pkg, version) {
    pkg["dependencies"]["quicktype-core"] = version;
}

function setCommit(pkg, commit) {
    if (pkg["config"] === undefined) {
        pkg["config"] = {};
    }
    pkg["config"]["commit"] = commit;
}

function checkCore(packageName) {
    if (packageName !== "quicktype-core") {
        throw new Error("buildCore can only build quicktype-core");
    }
}

function buildCore(buildDir) {
    inDir(buildDir, packageName => {
        checkCore(packageName);

        console.log(`Building ${packageName}`);

        run("npm", ["install"]);
    });
}

function srcDirForPackage(packageName) {
    const srcBase = path.join("..", "..", "src");
    const srcDir = path.join(srcBase, packageName);

    if (!fs.existsSync(srcDir)) {
        console.error(`Error: Source directory ${srcDir} for package ${packageName} does not exist.`);
        process.exit(1);
    }

    return srcDir;
}

function copySources(buildDir, then) {
    inDir(buildDir, packageName => {
        const srcDir = srcDirForPackage(packageName);

        console.log(`Building ${packageName}`);

        try {
            if (!fs.existsSync("src")) {
                run("mkdir", ["src"]);
            }

            for (const fn of fs.readdirSync(srcDir).filter(fn => endsWith(fn, ".ts"))) {
                const dstPath = path.join("src", fn);
                copyFile(path.join(srcDir, fn), dstPath);
                mapFile(dstPath, dstPath, content =>
                    replaceAll(content, '} from "../quicktype-core', '} from "quicktype-core')
                );
            }
            copyFile(path.join(srcDir, "tsconfig.json"), "./");

            then(packageName);
        } catch (e) {
            console.error(e);
            process.exit(1);
        } finally {
            ignoreExceptions(() => fs.unlinkSync("tsconfig.json"));
            ignoreExceptions(() => run("rm", ["-rf", "src"]));
        }
    });
}

function buildPackage(buildDir, doPublish) {
    copySources(buildDir, packageName => {
        withPackage(pkg => setQuicktypeCore(pkg, "file:../quicktype-core"), () => run("npm", ["install"]));

        if (!doPublish) return;

        const corePkg = JSON.parse(fs.readFileSync(path.join("..", "quicktype-core", "package.json")));
        const coreVersion = corePkg["version"];

        publish(
            packageName,
            commit =>
                console.log(`Publishing ${packageName} with commit ${commit} using quicktype-core ${coreVersion}`),
            () => setQuicktypeCore(pkg, coreVersion)
        );
    });
}

function publish(packageName, print, update) {
    const commit = gitRevParse("HEAD");

    const srcDir = srcDirForPackage(packageName);
    const hasUncommittedChanges = gitHasDiff("HEAD", srcDir);

    if (hasUncommittedChanges) {
        console.error(`There are uncommitted change in ${srcDir} - cowardly refusing to publish package`);
        process.exit(1);
    }

    const latestVersion = latestPackageVersion(packageName);

    const latestCommit = packageCommit(packageName, latestVersion);
    const hasChangesToPackage = gitHasDiff(latestCommit, srcDir);

    console.log(`latest version is ${latestVersion} commit ${latestCommit}`);

    if (!hasChangesToPackage) {
        console.log("No changes since the last package - not publishing");
        return;
    }

    print(commit);

    withPackage(pkg => setCommit(pkg, commit), () => run("npm", ["publish"]));
}

function publishCore(buildDir) {
    inDir(buildDir, packageName => {
        checkCore(packageName);
        publish(packageName, commit => console.log(`Publishing ${packageName} with commit ${commit}`), () => undefined);
    });
}

module.exports = { buildCore, buildPackage, publishCore };
