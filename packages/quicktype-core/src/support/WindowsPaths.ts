// Windows absolute paths given as schema addresses are carried through the
// address machinery as "file:" URIs (issue #2869). These two functions are
// the two halves of that protocol: JSONSchemaInput converts Windows paths to
// "file:" URIs before urijs parses them, and NodeIO converts "file:" URIs
// back to file paths when it reads them from disk.

// Windows absolute paths are not valid URIs: urijs parses the drive letter
// of e.g. "C:\Users\me\top.schema.json" as a URI scheme (and lowercases it,
// and treats the backslashes as an opaque path), so relative refs resolve to
// bogus addresses (issue #2869). Convert drive-letter and UNC paths to
// "file:" URIs, which NodeIO knows how to read.
export function fixWindowsPath(pathOrURI: string): string {
    if (/^[A-Za-z]:[/\\]/.test(pathOrURI)) {
        // Drive-letter path, e.g. "C:\dir\x.json" -> "file:///C:/dir/x.json"
        return `file:///${pathOrURI.replace(/\\/g, "/")}`;
    }

    if (pathOrURI.startsWith("\\\\")) {
        // UNC path, e.g. "\\server\share\x.json" -> "file://server/share/x.json"
        return `file:${pathOrURI.replace(/\\/g, "/")}`;
    }

    return pathOrURI;
}

// We don't use `url.fileURLToPath` because its result is platform-dependent:
// drive-letter URIs must also be readable on POSIX (as paths relative to the
// working directory), which is how the tests exercise this, and Node's fs
// accepts forward slashes on Windows anyway. The addresses were URI-decoded
// when they were normalized, so there's no percent-decoding to do here.
export function filePathFromFileURI(fileURI: string): string {
    const path = fileURI.slice("file://".length);
    if (/^\/[A-Za-z]:\//.test(path)) {
        // Drive-letter path, e.g. "file:///C:/dir/x.json" -> "C:/dir/x.json"
        return path.slice(1);
    }

    if (!path.startsWith("/")) {
        // UNC path, e.g. "file://server/share/x.json" -> "//server/share/x.json"
        return `//${path}`;
    }

    return path;
}
