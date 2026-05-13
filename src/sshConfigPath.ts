export function resolveSshConfigPath(configuredPath: string | undefined, homeDir: string): string {
    const rawPath = configuredPath?.trim() || "~/.ssh/config";
    return expandHomePath(rawPath, homeDir);
}

export function expandHomePath(inputPath: string, homeDir: string): string {
    if (inputPath === "~") {
        return homeDir;
    }

    if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
        return `${homeDir}${inputPath.slice(1)}`;
    }

    return inputPath;
}