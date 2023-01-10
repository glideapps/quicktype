"use strict";

const fs = require("fs");
const path = require("path");
const spawnSync = require("child_process").spawnSync;
const semver = require("semver");

function mapFile(source, destination, transform) {
    // console.log(`mapping ${source} to ${destination}`);
    const content = fs.readFileSync(source, "utf8");
    fs.writeFileSync(destination, transform(content));
    if (!fs.existsSync(destination)) {
        console.error(`Error: Map from ${source} to ${destination} failed - destination file doesn't exist.`);
        process.exit(1);
    }
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

function runNPM(args, returnOutput = false, returnStatus = false) {
    return run("npm", args, returnOutput, returnStatus);
}

function gitRevParse(rev) {
    return run("git", ["rev-parse", rev], true).trim();
}

function gitHasDiff(oldRev, inDir) {
    return run("git", ["diff", "--quiet", oldRev, inDir], false, true) !== 0;
}

function npmShow(packageName, path) {
    return JSON.parse(runNPM(["show", "--json", packageName, path], true));
}

function latestPackageVersion(packageName) {
    const versions = npmShow(packageName, "versions");
    return versions[versions.length - 1];
}

function quicktypeCoreDependency(packageName) {
    return npmShow(packageName, "dependencies.quicktype-core");
}

function packageCommit(packageName, version) {
    const commit = runNPM(["show", `${packageName}@${version}`, "config.commit"], true).trim();
    if (commit === "") {
        console.error("Error: No commit for latest package version");
        process.exit(1);
    }
    return commit;
}

function copyFile(src, dst) {
    // console.log(`copying ${src} to ${dst}`);
    run("cp", [src, dst]);
    if (!fs.existsSync(dst)) {
        console.error(`Error: Copy from ${src} to ${dst} failed - destination file doesn't exist.`);
        process.exit(1);
    }
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

function readPackageFile(fn) {
    if (fn === undefined) {
        fn = "package.in.json";
    }
    return JSON.parse(fs.readFileSync(fn, "utf8"));
}

function versionInPackageFile() {
    return readPackageFile().version;
}

function makePackage(update) {
    const pkg = readPackageFile();
    update(pkg);
    fs.writeFileSync("package.json", JSON.stringify(pkg, undefined, 4));
}

function withPackage(update, f) {
    makePackage(update);
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

function srcDirForPackage(packageName) {
    const srcBase = path.join("..", "..", "src");
    const srcDir = path.join(srcBase, packageName);

    if (!fs.existsSync(srcDir)) {
        console.error(`Error: Source directory ${srcDir} for package ${packageName} does not exist.`);
        process.exit(1);
    }

    return srcDir;
}

function mkdirs(dir) {
    const components = dir.split(path.sep);
    if (components.length === 0) {
        throw new Error("mkdirs must be called with at least one path component");
    }
    let soFar;
    if (components[0].length === 0) {
        soFar = "/";
        components.shift();
    } else {
        soFar = ".";
    }
    for (const c of components) {
        soFar = path.join(soFar, c);
        try {
            fs.mkdirSync(soFar);
        } catch (e) {
            const stat = fs.statSync(soFar);
            if (stat.isDirectory()) continue;
            throw e;
        }
    }
}

function copyFilesInDir(srcDir, dstDir, suffix, transform) {
    let directoryMade = false;
    for (const fn of fs.readdirSync(srcDir)) {
        const srcPath = path.join(srcDir, fn);
        const dstPath = path.join(dstDir, fn);
        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
            copyFilesInDir(srcPath, dstPath, suffix, transform);
        } else if (fn.endsWith(suffix)) {
            if (!directoryMade) {
                mkdirs(dstDir);
                directoryMade = true;
            }
            if (transform !== undefined) {
                mapFile(srcPath, dstPath, transform);
            } else {
                copyFile(srcPath, dstPath);
            }
        }
    }
}

function copySources(buildDir, then) {
    inDir(buildDir, packageName => {
        const srcDir = srcDirForPackage(packageName);

        try {
            copyFilesInDir(srcDir, "src", ".ts", content =>
                replaceAll(content, '} from "../quicktype-core', '} from "quicktype-core')
            );
            copyFile(path.join(srcDir, "tsconfig.json"), "./");
            copyFile(path.join(srcDir, "../../LICENSE"), "./");

            then(packageName);
        } catch (e) {
            console.error(e);
            process.exit(1);
        } finally {
            ignoreExceptions(() => fs.unlinkSync("LICENSE"));
            ignoreExceptions(() => fs.unlinkSync("tsconfig.json"));
            ignoreExceptions(() => run("rm", ["-rf", "src"]));
        }
    });
}

function buildCore(buildDir, options) {
    copySources(buildDir, packageName => {
        checkCore(packageName);

        console.log(`Building ${packageName}`);

        makePackage(pkg => {
            pkg.version = latestPackageVersion(packageName);
        });
        runNPM(["install"]);
        runNPM(["run", "build"]);

        if (!options.publish) return;

        checkCore(packageName);
        publish(
            packageName,
            options.force,
            (version, commit) => console.log(`Publishing ${packageName} ${version} with commit ${commit}`),
            () => undefined
        );
    });
}

function versionToPublish(latestVersion) {
    // auto-increment patch version
    const versionInPackage = versionInPackageFile();
    if (semver.lte(versionInPackage, latestVersion)) {
        return semver.inc(latestVersion, "patch");
    } else {
        return versionInPackage;
    }
}

function buildPackage(buildDir, options) {
    copySources(buildDir, packageName => {
        console.log(`Building ${packageName}`);

        withPackage(
            pkg => {
                pkg.version = latestPackageVersion(packageName);
                setQuicktypeCore(pkg, "file:../quicktype-core");
            },
            () => {
                runNPM(["install"]);
                runNPM(["run", "build"]);
            }
        );

        if (!options.publish) return;

        const coreVersion = readPackageFile(path.join("..", "quicktype-core", "package.json")).version;

        const latestCoreDependency = quicktypeCoreDependency(packageName);

        const coreDependencyUpToDate = semver.satisfies(coreVersion, latestCoreDependency);

        console.log(
            `quicktype-core dependency ${latestCoreDependency} of latest package is ${
                coreDependencyUpToDate ? "" : "in"
            }compatible with current version ${coreVersion}.`
        );
        if (!coreDependencyUpToDate) {
            console.log("Publishing new package whether there are code changes or not.");
        }

        publish(
            packageName,
            !coreDependencyUpToDate,
            (version, commit) =>
                console.log(
                    `Publishing ${packageName} ${version} with commit ${commit} using quicktype-core ${coreVersion}`
                ),
            pkg => setQuicktypeCore(pkg, "^" + coreVersion)
        );
    });
}

function publish(packageName, force, print, update) {
    const commit = gitRevParse("HEAD");

    const srcDir = srcDirForPackage(packageName);
    const hasUncommittedChanges = gitHasDiff("HEAD", srcDir);

    if (hasUncommittedChanges) {
        console.error(`There are uncommitted change in ${srcDir} - cowardly refusing to publish package`);
        process.exit(1);
    }

    const latestVersion = latestPackageVersion(packageName);

    if (!force) {
        const latestCommit = packageCommit(packageName, latestVersion);
        const hasChangesToPackage = gitHasDiff(latestCommit, srcDir);

        if (!hasChangesToPackage) {
            console.log("No changes since the last package - not publishing");
            return;
        }
    }

    const newVersion = versionToPublish(latestVersion);
    print(newVersion, commit);

    makePackage(pkg => {
        pkg.version = newVersion;
        setCommit(pkg, commit);
        update(pkg);
    });
    runNPM(["publish"]);
}

function usage() {
    console.log(`Usage: ${process.argv[1]} [publish] [force]`);
}

function getOptions() {
    const opts = { publish: false, force: false };
    for (const arg of process.argv.slice(2)) {
        if (arg === "help") {
            usage();
            process.exit(0);
        } else if (arg === "publish") {
            opts.publish = true;
        } else if (arg === "force") {
            opts.force = true;
        } else {
            usage();
            process.exit(1);
        }
    }
    return opts;
}

module.exports = { buildCore, buildPackage, getOptions };
